// WorldDefinition — the data-driven description of a Siege Worlds world.
//
// HARD RULE (Geoff, 2026-Jun-10): nothing about a world is hardcoded in the
// engine. Size, bounds, spawn, ground, water, sky all come from here (or, later,
// from the `worlds` table / per-world JSON). The 2000x2000 first map is just one
// WorldDefinition; new worlds are new definitions. No magic dimension constants.
//
// This is intentionally broader than what slice 1a renders — it carries fields
// for water and wind-animated props now so the engine is built around them from
// the start, even though 1a only needs ground + spawn.

export type Vec3 = [number, number, number];

/** How the ground is produced for this world. */
export type GroundKind =
  | 'flat'          // a flat plane (placeholder for 1a; size from `flatSize`)
  | 'gltf-terrain'; // a glTF/mesh terrain loaded from `terrainUrl` (real SW terrain)

export interface GroundConfig {
  kind: GroundKind;
  /** Top surface Y of the ground for 'flat' (and fallback floor). Default 0. */
  surfaceY?: number;
  /** Half-extent (meters) of the flat placeholder plane. Configurable, NOT a constant. */
  flatSize?: number;
  /** glTF/mesh URL for 'gltf-terrain'. */
  terrainUrl?: string;
  /** Optional ground texture override (else world/default). */
  textureUrl?: string;
}

/**
 * A water region. SW players currently FALL IN and WALK THE BOTTOM (no swimming).
 * Modeled as an axis-aligned volume so collision/movement can switch modes inside it.
 * Multiple volumes per world; shapes can be refined later (heightfield, mesh) without
 * changing call sites that just ask "am I in water, and what movement applies?".
 */
export interface WaterVolume {
  /** AABB min corner (world space). */
  min: Vec3;
  /** AABB max corner (world space). */
  max: Vec3;
  /** Visible water surface Y. */
  surfaceY: number;
  /** Movement while submerged. SW default = walk the bottom; 'swim' reserved for later. */
  movement: 'walk-bottom' | 'swim';
}

/** Whether a placed prop animates. Trees etc. sway in the wind; crates don't. */
export type PropSway = 'none' | 'wind';

/**
 * Per-mesh classification used when instancing the prop layer (outputTileData.csv).
 * Keyed by mesh base name (e.g. 'SM_Tree_Pine_02'). Anything not listed defaults to 'none'.
 * Kept as data so artists/me can flag new sway meshes without touching engine code.
 */
export interface PropClass {
  sway: PropSway;
  /** Optional sway tuning (amplitude in meters, speed). Engine supplies defaults. */
  swayAmplitude?: number;
  swaySpeed?: number;
  /**
   * Destructible props (replicates Unity `DestructibleSwap`, e.g. Harold's Island):
   * an intact mesh swaps to a pre-fractured set of chunk meshes on break, the chunks
   * get a physics impulse, then clean up. Chained pieces handled via `connected` at
   * placement time. Omitted = indestructible.
   */
  destructible?: {
    health: number;
    /** glTF of the pre-shattered chunks (exported alongside the intact mesh). */
    fracturedMeshUrl?: string;
    explosionForce?: number;
    explosionRadius?: number;
    upwardsModifier?: number;
    randomTorque?: number;
    /** Seconds before fractured chunks are removed (0 = never). */
    destroyAfterSeconds?: number;
  };
}

export interface WorldDefinition {
  /** Stable id; matches the `worlds` table row / GAME_ID-scoped world. */
  id: string;
  name: string;

  /**
   * World rendering kind — the engine supports BOTH:
   *  'voxel' = Dreadroot block/chunk world (CameraTrackedBlocks).
   *  'siege' = Siege Worlds heightfield terrain + placed glTF objects (SiegeWorldLayers).
   * The player, controls, jet-boost, weapons, and HUD are identical for both.
   */
  kind?: 'voxel' | 'siege';

  /**
   * Opt-in: enable true triangle-accurate MESH colliders (three-mesh-bvh) for
   * models flagged with the M tool — so the player walks real rock/mountain
   * surfaces instead of stair-stepped boxes. OFF by default: when omitted/false
   * the mesh-collision system is fully inert (no BVH builds, no per-frame pass),
   * so worlds/games that don't need it (DreadRoot, Pinkland) run faster. A future
   * DreadRoot world can opt in by setting this true.
   */
  meshColliders?: boolean;

  /**
   * Optional play bounds (meters, [minXZ, maxXZ]). NULL/omitted = unbounded/auto —
   * worlds are meant to extend, so bounds are advisory, never a hard engine limit.
   */
  bounds?: { min: [number, number]; max: [number, number] } | null;

  ground: GroundConfig;

  /** Where the player spawns. */
  spawn: { position: Vec3; yaw?: number };

  /** Water regions (optional). */
  water?: WaterVolume[];

  sky?: { textureUrl?: string };

  /**
   * Prop layer source (the data-driven scenery). For the SW first map this is the
   * exported placement file; meshes resolve to converted glTF. Omitted in 1a.
   */
  props?: {
    /** URL/path to the placement data (converted from outputTileData.csv). */
    placementUrl?: string;
    /** Base path where converted glTF meshes live. */
    meshBaseUrl?: string;
    /** Per-mesh animation/classification overrides. */
    classes?: Record<string, PropClass>;
  };
}

/**
 * The first SW world — placeholder ground for slice 1a so we can walk/run/fly
 * immediately. `flatSize` is generous but configurable; the real terrain swaps in
 * via `ground.kind = 'gltf-terrain'` once extracted (no engine changes needed).
 */
export const SIEGE_TEST_WORLD: WorldDefinition = {
  id: 'siege-test',
  name: 'Siege Worlds',
  kind: 'siege',
  meshColliders: true, // SWW uses BVH mesh colliders for rocks/mountains
  bounds: null, // 4×4 grid of 500m tiles ≈ 2000×2000, but never hardcoded here
  ground: { kind: 'gltf-terrain', surfaceY: 0 },
  // Player start on Lobby Island (engine frame = -UnityX). Y just above sea level (22).
  spawn: { position: [-96, 25, 325], yaw: 0 },
  // Sea level from Client.cs WATER_HEIGHT=22 (depth to ~9.8). Walk-the-bottom, no swim yet.
  water: [{ min: [-2000, 9.8, -214], max: [0, 22, 1786], surfaceY: 22, movement: 'walk-bottom' }],
  props: undefined,
};

/** Registry of known SW worlds (later: load from the `worlds` table). */
export const SIEGE_WORLDS: Record<string, WorldDefinition> = {
  [SIEGE_TEST_WORLD.id]: SIEGE_TEST_WORLD,
};

export function getWorldDefinition(id: string | null | undefined): WorldDefinition {
  if (id && SIEGE_WORLDS[id]) return SIEGE_WORLDS[id];
  return SIEGE_TEST_WORLD;
}
