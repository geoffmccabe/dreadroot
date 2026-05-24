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

/** Runtime hop state. Predator pattern: idle → stalk (crawl) → pounce (hop). */
export type HopPhase = 'idle' | 'crawling' | 'hopping';

export interface HopState {
  phase: HopPhase;
  // While 'idle': time to start the next stalk/hop window.
  nextHopAt: number;
  // While 'crawling': linear progress 0..1 over the crawl duration.
  crawlStartAt: number;
  crawlDurationMs: number;
  crawlStartX: number;
  crawlStartZ: number;
  crawlEndX: number;
  crawlEndZ: number;
  // While 'hopping': parabolic-arc anchors.
  hopStartAt: number;
  hopDurationMs: number;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  arcHeight: number;
  // Surface normal at the *landing* target so the renderer can pivot
  // the body to lie flat on the new face on touchdown.
  endNormalX: number;
  endNormalY: number;
  endNormalZ: number;
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

  /** "Up" for the shpider — points away from whatever face it's on. */
  surfaceNormal: THREE.Vector3;

  // Per-leg random gait parameters — generated once at spawn so each
  // shpider has a visually distinct walking pattern that persists for
  // its lifetime.
  legPhaseOffsets: number[];   // length = LEGS_PER_SHPIDER
  legFrequencies: number[];    // step cycles/sec multiplier per leg
  legLiftAmplitudes: number[]; // max foot lift per leg (× halfBody)

  // Head horizontal slide oscillator — phase offset so neighbours
  // don't all bob in sync.
  headSlidePhase: number;

  // Mandible click state. Per-shpider random schedule.
  nextMandibleClickAt: number; // ms timestamp
  mandibleClickStartedAt: number; // ms timestamp (0 if not clicking)

  // Touch-attack throttle so a shpider can't melee every frame.
  lastAttackAt: number;

  // Eye-tracking state: single cyclops eye on the head's front face.
  // The pupil smoothly follows the nearest player; falls back to a
  // random look-around cycle. Same idea as Shtickman.
  eyeTargetX: number;          // -1..+1 (left ↔ right inside white)
  eyeTargetY: number;          // -1..+1 (down ↔ up)
  eyePupilX: number;           // smoothed toward target
  eyePupilY: number;
  eyeLastRandomLookAt: number;
}
