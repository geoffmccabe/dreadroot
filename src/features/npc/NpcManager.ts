/**
 * NpcManager — module-level singleton that owns the new-system NPC registry +
 * the live spawned instances. Like EnemyManager, it lives outside React so the
 * in-canvas EMS renderer, the DOM NPC panel, and the `@` spawn command all share
 * one source of truth with no prop-drilling. This is the PARALLEL system; the
 * legacy enemies/friends are entirely separate and untouched.
 */
import * as THREE from 'three';
import type { EMSDefinition, EMSNode } from './ems/types';
import { orderNodes, createNodeRuntime, type NodeRuntime } from './ems/simulation';

export interface NpcInstance {
  id: string;
  def: EMSDefinition;
  position: THREE.Vector3;
  yaw: number;
  isActive: boolean;
  /** nodes ordered parents-first (cached per instance). */
  ordered: EMSNode[];
  /** per-node spring/world runtime, keyed by node id. */
  runtimes: Map<string, NodeRuntime>;
  /** locomotion phase (drives the walk/hop bob). */
  phase: number;
  health: number;
  spawnedAt: number;
}

type Listener = () => void;

class NpcManagerImpl {
  private instances: NpcInstance[] = [];
  private definitions = new Map<string, EMSDefinition>();
  private listeners = new Set<Listener>();
  private idCounter = 0;
  /** bumped on any change so React subscribers can re-render. */
  version = 0;

  // ── definitions (the registry) ──
  registerDefinition(def: EMSDefinition): void {
    this.definitions.set(def.slug, def);
    this.bump();
  }
  getDefinitions(): EMSDefinition[] {
    return Array.from(this.definitions.values());
  }
  getDefinition(slug: string): EMSDefinition | undefined {
    return this.definitions.get(slug);
  }

  // ── live instances ──
  spawn(slug: string, x: number, y: number, z: number, yaw = 0): NpcInstance | null {
    const def = this.definitions.get(slug);
    if (!def) return null;
    const inst: NpcInstance = {
      id: `npc_${++this.idCounter}`,
      def,
      position: new THREE.Vector3(x, y, z),
      yaw,
      isActive: true,
      ordered: orderNodes(def.nodes),
      runtimes: new Map(def.nodes.map((n) => [n.id, createNodeRuntime()])),
      phase: Math.random() * Math.PI * 2,
      health: def.health,
      spawnedAt: Date.now(),
    };
    this.instances.push(inst);
    this.bump();
    return inst;
  }

  despawn(id: string): void {
    const before = this.instances.length;
    this.instances = this.instances.filter((i) => i.id !== id);
    if (this.instances.length !== before) this.bump();
  }

  clearAll(): void {
    if (this.instances.length === 0) return;
    this.instances = [];
    this.bump();
  }

  // ── editing (the builder writes through these) ──
  private nodeCounter = 0;

  /** Re-derive ordering + reconcile per-node runtime for live instances of a
   *  def after a structural edit. Keeps the spring state of unchanged nodes so
   *  the wobble doesn't reset on every keystroke. */
  private reconcile(slug: string): void {
    for (const inst of this.instances) {
      if (inst.def.slug !== slug) continue;
      inst.ordered = orderNodes(inst.def.nodes);
      const ids = new Set(inst.def.nodes.map((n) => n.id));
      for (const id of Array.from(inst.runtimes.keys())) {
        if (!ids.has(id)) inst.runtimes.delete(id);
      }
      for (const n of inst.def.nodes) {
        if (!inst.runtimes.has(n.id)) inst.runtimes.set(n.id, createNodeRuntime());
      }
    }
  }

  updateMeta(
    slug: string,
    patch: Partial<Pick<EMSDefinition, 'name' | 'faction' | 'locomotion' | 'scale' | 'moveSpeed' | 'health' | 'damagePerHit'>>,
  ): void {
    const def = this.definitions.get(slug);
    if (!def) return;
    Object.assign(def, patch);
    this.bump();
  }

  updateNode(slug: string, nodeId: string, patch: Partial<EMSNode>): void {
    const def = this.definitions.get(slug);
    if (!def) return;
    const node = def.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    Object.assign(node, patch);
    if (node.bond === 'spring' && !node.spring) node.spring = { stiffness: 100, damping: 7 };
    this.reconcile(slug);
    this.bump();
  }

  addNode(slug: string): string | null {
    const def = this.definitions.get(slug);
    if (!def) return null;
    const id = `n${++this.nodeCounter}`;
    def.nodes.push({
      id, shape: 'box', offset: [0, 0.5, 0], size: [0.4, 0.4, 0.4],
      parent: def.nodes[0]?.id ?? null, bond: 'rigid', color: '#cccccc',
    });
    this.reconcile(slug);
    this.bump();
    return id;
  }

  removeNode(slug: string, nodeId: string): void {
    const def = this.definitions.get(slug);
    if (!def || def.nodes.length <= 1) return; // keep at least the body
    const removed = def.nodes.find((n) => n.id === nodeId);
    if (!removed) return;
    // Re-parent children of the removed node up to its parent.
    for (const n of def.nodes) if (n.parent === nodeId) n.parent = removed.parent;
    def.nodes = def.nodes.filter((n) => n.id !== nodeId);
    this.reconcile(slug);
    this.bump();
  }

  /** Create a blank editable NPC (one body box) and return it. */
  createDefinition(): EMSDefinition {
    const slug = `npc_custom_${++this.idCounter}`;
    const def: EMSDefinition = {
      slug, name: 'New NPC', faction: 'enemy', skeleton: 'custom',
      nodes: [{ id: 'body', shape: 'box', offset: [0, 1, 0], size: [1, 1, 1], parent: null, bond: 'rigid', color: '#8888aa' }],
      locomotion: 'walk', moveSpeed: 2, scale: 1, behaviorTreeId: null, health: 100, damagePerHit: 5,
    };
    this.definitions.set(slug, def);
    this.bump();
    return def;
  }

  deleteDefinition(slug: string): void {
    if (!this.definitions.has(slug)) return;
    this.definitions.delete(slug);
    this.instances = this.instances.filter((i) => i.def.slug !== slug);
    this.bump();
  }

  getInstances(): NpcInstance[] {
    return this.instances;
  }
  count(): number {
    return this.instances.length;
  }

  // ── React subscription (used by the renderer + the panel) ──
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const npcManager = new NpcManagerImpl();
