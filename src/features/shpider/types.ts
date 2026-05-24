import * as THREE from 'three';

/**
 * Admin-configurable Shpider definition (one row per tier).
 * Three textures: body (wraps body+head cubes), legs (outer faces of
 * leg segments), face (front face of head).
 */
export interface ShpiderDefinition {
  id: string;
  tier: number;
  name: string;

  // Visuals
  body_texture_url: string | null;
  leg_texture_url: string | null;
  face_texture_url: string | null;
  body_texture_url_ktx2?: string | null;
  leg_texture_url_ktx2?: string | null;
  face_texture_url_ktx2?: string | null;
  texture_tier?: 'standard' | 'premium';

  // Audio
  hop_sound_url: string | null;
  attack_sound_url: string | null;
  death_sound_url: string | null;

  // Gameplay
  health: number;
  damage_per_hit: number;
  knockback_received: number;
  speed_during_hop: number;
  spawn_chance_per_minute: number;

  // Hop physics
  hop_interval_min_ms: number;
  hop_interval_max_ms: number;
  hop_distance_min: number;
  hop_distance_max: number;
  hop_arc_factor: number;
  hop_duration_ms: number;

  // Body geometry
  body_size: number;
  head_size: number;

  // Behavior
  can_climb_trees: boolean;

  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;

  created_at: string;
  updated_at: string;
}

/** Runtime hop state — used by Phase 4 hop AI. */
export type HopPhase = 'idle' | 'hopping';

export interface HopState {
  phase: HopPhase;
  // While 'idle': time at which to start the next hop.
  nextHopAt: number;
  // While 'hopping': interpolation anchors.
  hopStartAt: number;
  hopDurationMs: number;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  // Peak Y above the linear path midpoint.
  arcHeight: number;
}

/**
 * Runtime instance of an active Shpider in the world.
 */
export interface ShpiderInstance {
  id: string;
  definition: ShpiderDefinition;
  position: THREE.Vector3;
  rotation: number;
  currentHealth: number;
  maxHealth: number;
  isActive: boolean;
  spawnedAt: number;
  velocity: THREE.Vector3;
  spawnChunkX: number;
  spawnChunkZ: number;
  scale: number;

  hop: HopState;

  // Per-leg jitter for the idle / mid-hop animation.
  legPhaseOffsets: number[]; // length = LEGS_PER_SHPIDER

  // Head moves independently of body (slight bob + look-at-player).
  headYawOffset: number;
  headPitchOffset: number;
}
