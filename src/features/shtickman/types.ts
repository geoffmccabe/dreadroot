import * as THREE from 'three';

/**
 * Shtickman definition from database - admin-configurable enemy tiers
 */
export interface ShtickmanDefinition {
  id: string;
  tier: number;
  name: string;
  // Visuals
  body_texture_url: string | null;
  head_texture_url: string | null;
  face_texture_url: string | null;
  // Audio per tier
  roar_sound_url: string | null;
  throw_sound_url: string | null;
  death_sound_url: string | null;
  proximity_sound_url: string | null;
  // Gameplay
  speed: number;
  health: number;
  damage_per_hit: number;
  knockback_received: number;
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
  // Pathfinding configuration code (references pathfinding_configs table)
  pathfinding_config_code?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Runtime state for an active shtickman instance
 */
export interface ShtickmanInstance {
  id: string;
  definition: ShtickmanDefinition;
  tier: number;

  position: THREE.Vector3;
  rotationY: number;

  currentHealth: number;
  maxHealth: number;
  isActive: boolean;

  targetPos: THREE.Vector3;    // current movement target (waypoint or final destination)
  targetTreeId: string | null; // ID of the tree we're patrolling to
  nextTargetAt: number;        // time to pick new target tree
  velocity: THREE.Vector3;     // for knockback smoothing
  lastDamagedAt: number;

  // Pathfinding state
  currentPath: THREE.Vector3[] | null; // A* path waypoints
  currentPathIndex: number;            // Current waypoint index in path
  lastPathfindAt: number;              // Time of last pathfinding attempt

  // Cached dimensions computed from tier
  heightBlocks: number;
  headSizeBlocks: number;

  // Animation phase
  animationPhase: number;
  spawnedAt: number;

  // Scale variation for visual variety
  scale: number;

  // Proximity sound tracking
  lastProximitySoundAt: number;

  // Eye tracking state
  eyeState: {
    leftPupilOffset: { x: number; y: number };   // -1 to 1 range on eye surface
    rightPupilOffset: { x: number; y: number };
    targetOffset: { x: number; y: number };       // Where pupils want to be
    lastTargetChangeAt: number;
    isTrackingPlayer: boolean;
    trackedPlayerId: string | null;
  };
}

/**
 * Calculate height in blocks based on tier
 * Tier 1 = 22 blocks, each tier adds +2 blocks, capped at tier 10 = 40 blocks
 */
export function getHeightBlocks(tier: number): number {
  return 22 + (tier - 1) * 2;
}

/**
 * Calculate head size in blocks based on tier
 * Tier 1 head = 3x3x3, Tier 10 head = 6x6x6
 * Linear interpolation with integer rounding
 */
export function getHeadSizeBlocks(tier: number): number {
  // Tier 1 = 3, Tier 10 = 6, linear interpolation
  const minSize = 3;
  const maxSize = 6;
  const size = minSize + ((tier - 1) / 9) * (maxSize - minSize);
  return Math.round(size);
}
