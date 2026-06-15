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
