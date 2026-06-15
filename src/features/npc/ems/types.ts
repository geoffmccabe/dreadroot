/**
 * EMS — Electromagnetic Skeleton — the DreadRoot NPC body model.
 *
 * DreadRoot NPCs (enemies AND friends) are not biological: they are PRIMITIVES
 * (box/sphere/capsule/cone/cylinder) held together by simulated electromagnetic
 * BONDS. Rigid bonds stick primitives together; spring bonds let them bounce /
 * wobble / lag — the emergent, un-keyframed motion that is DreadRoot's signature.
 *
 * An NPC is built in LAYERS, all pure DATA so the visual editor + the AI author
 * can read/write it:
 *   skeleton (nodes + bond graph) → movement rules → primitives → textures →
 *   magic (collider-less FX) → AI (behavior tree) → combat (health/damage/armor).
 *
 * This file is the data shapes only — no THREE / React. The simulation, renderer,
 * and editor all consume these.
 */

export type PrimitiveShape = 'box' | 'sphere' | 'capsule' | 'cone' | 'cylinder';

export type BondType = 'rigid' | 'spring';

export interface SpringParams {
  /** higher = snaps back to rest faster (stiffer). */
  stiffness: number;
  /** higher = less oscillation (more damped). */
  damping: number;
}

/**
 * One primitive in the skeleton. Its rest pose is `offset` from its parent
 * (or the body root if parent is null); the bond decides whether it holds that
 * pose rigidly or springs around it.
 */
export interface EMSNode {
  id: string;
  shape: PrimitiveShape;
  /** rest offset from parent node (or root), in blocks, before rotation. */
  offset: [number, number, number];
  /** primitive size in blocks (x,y,z; for sphere x=diameter, cylinder x=z=diameter, y=height). */
  size: [number, number, number];
  /** parent node id, or null = bonded directly to the body root. */
  parent: string | null;
  bond: BondType;
  /** required when bond === 'spring'. */
  spring?: SpringParams;
  /** texture/atlas key; falls back to `color` when absent. */
  texture?: string;
  /** hex tint used when no texture (and as the primitive's base color). */
  color: string;
}

export type Locomotion = 'static' | 'walk' | 'hop' | 'fly';

/** A reusable skeleton template id (biped, quadruped, hopper, blob…). */
export type SkeletonTemplate = string;

/**
 * The full layered definition of an EMS NPC. This is the record the registry
 * stores, the editor edits, the AI author writes, and the spawner instantiates.
 */
export interface EMSDefinition {
  /** unique id across the NPC system. */
  slug: string;
  name: string;
  /** 'enemy' | 'friend' — drives hostility, leaderboards, spawn category. */
  faction: 'enemy' | 'friend';

  // ── skeleton layer ──
  skeleton: SkeletonTemplate;
  nodes: EMSNode[];

  // ── movement / animation rules layer ──
  locomotion: Locomotion;
  /** blocks/sec root movement speed. */
  moveSpeed: number;
  /** overall body scale multiplier. */
  scale: number;

  // ── AI layer (behavior tree id; wired in a later phase — null = idle stub). ──
  behaviorTreeId: string | null;

  // ── combat layer ──
  health: number;
  damagePerHit: number;
}

/** Per-node live simulation state (spring displacement + velocity). */
export interface EMSNodeSim {
  dispX: number; dispY: number; dispZ: number;
  velX: number; velY: number; velZ: number;
}
