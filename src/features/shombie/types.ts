import * as THREE from 'three';

/**
 * Shombie definition from database - admin-configurable enemy tiers
 */
export interface ShombieDefinition {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  speed: number; // blocks per second (default: 2 = half player speed)
  health: number;
  damage_per_hit: number;
  knockback_received: number; // how much they get knocked back when shot
  spawn_chance_per_minute: number;
  created_at: string;
  updated_at: string;
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

/**
 * Body part definition for block-based zombie
 */
export interface ShombiePart {
  name: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

/**
 * Runtime state for an active shombie instance
 */
export interface ShombieInstance {
  id: string;
  definition: ShombieDefinition;
  position: THREE.Vector3;
  rotation: number; // Y rotation in radians
  currentHealth: number;
  maxHealth: number;
  isActive: boolean;
  spawnedAt: number;
  /** Velocity for knockback and movement */
  velocity: THREE.Vector3;
  /** Animation phase for ambling movement */
  animationPhase: number;
  /** Last time this shombie attacked */
  lastAttackAt: number;
  /** Last time damaged (for knockback tracking) */
  lastDamagedAt: number;
  /** Chunk coordinates where spawned */
  spawnChunkX: number;
  spawnChunkZ: number;
  /** Scale factor (0.8 to 1.2 for ±20% variation) */
  scale: number;
  /** Emergence progress (0 = underground, 1 = fully emerged) */
  emergenceProgress: number;
}

/**
 * Shombie body structure - humanoid made of blocks
 * All offsets are relative to the base position (feet)
 */
export const SHOMBIE_BODY_PARTS: ShombiePart[] = [
  // Head (1x1x1)
  { name: 'head', offsetX: 0, offsetY: 1.7, offsetZ: 0, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 },
  // Torso (wider, taller)
  { name: 'torso', offsetX: 0, offsetY: 1.0, offsetZ: 0, scaleX: 0.6, scaleY: 0.7, scaleZ: 0.4 },
  // Left arm
  { name: 'leftArm', offsetX: -0.45, offsetY: 1.1, offsetZ: 0, scaleX: 0.2, scaleY: 0.6, scaleZ: 0.2 },
  // Right arm
  { name: 'rightArm', offsetX: 0.45, offsetY: 1.1, offsetZ: 0, scaleX: 0.2, scaleY: 0.6, scaleZ: 0.2 },
  // Left leg
  { name: 'leftLeg', offsetX: -0.15, offsetY: 0.35, offsetZ: 0, scaleX: 0.25, scaleY: 0.7, scaleZ: 0.25 },
  // Right leg
  { name: 'rightLeg', offsetX: 0.15, offsetY: 0.35, offsetZ: 0, scaleX: 0.25, scaleY: 0.7, scaleZ: 0.25 },
];

// Number of parts per shombie for instanced rendering
export const PARTS_PER_SHOMBIE = SHOMBIE_BODY_PARTS.length;
