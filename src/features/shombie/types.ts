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
  /** Parent part for joint connections */
  parent?: string;
}

/**
 * Twitchiness state for a single body part
 */
export interface PartTwitch {
  /** Frequency multiplier for oscillation */
  frequency: number;
  /** Amplitude of movement */
  amplitude: number;
  /** Phase offset */
  phaseOffset: number;
  /** Type of twitch movement */
  twitchType: 'vertical' | 'horizontal' | 'rotate' | 'scale' | 'shake';
}

/**
 * Head movement type for varied animations
 */
export type HeadMovementType = 'slide' | 'bob' | 'circle';

/**
 * Runtime state for an active shombie instance
 */
/**
 * Fire effect attached to a body part
 */
export interface ShombieBodyFire {
  partName: string;
  startTime: number;
  duration: number; // ms
  colors: string[];
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
  /** Per-part twitchiness settings (randomized on spawn) */
  partTwitches: Record<string, PartTwitch>;
  /** Target position for pathfinding */
  targetPosition?: THREE.Vector3;
  /** Is currently chasing player */
  isChasing: boolean;
  /** Head movement type (1/3 slide, 1/3 bob, 1/3 circle) */
  headMovementType: HeadMovementType;
  /** Is knocked down (headshot) - falling backward and sliding */
  isKnockedDown: boolean;
  /** Knockdown direction (bullet travel direction) */
  knockdownDirection?: THREE.Vector3;
  /** Knockdown slide progress (0-1) */
  knockdownProgress: number;
  /** Knockdown start time */
  knockdownStartTime: number;
  /** Knockdown slide distance in blocks (1 per player level) */
  knockdownSlideDistance?: number;
  /** Stun end time (ms timestamp) - shombie doesn't move while stunned */
  stunUntil?: number;
  /** Active fires on body parts */
  bodyFires: ShombieBodyFire[];
}

/**
 * Shombie body structure - humanoid made of blocks with joints
 * All offsets are relative to the base position (feet)
 * Now includes elbows and knees for more articulated limbs
 */
export const SHOMBIE_BODY_PARTS: ShombiePart[] = [
  // Head (1x1x1)
  { name: 'head', offsetX: 0, offsetY: 1.7, offsetZ: 0, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 },
  // Torso (wider, taller)
  { name: 'torso', offsetX: 0, offsetY: 1.0, offsetZ: 0, scaleX: 0.6, scaleY: 0.7, scaleZ: 0.4 },
  
  // Left arm - upper (shoulder to elbow)
  { name: 'leftUpperArm', offsetX: -0.45, offsetY: 1.25, offsetZ: 0, scaleX: 0.18, scaleY: 0.35, scaleZ: 0.18, parent: 'torso' },
  // Left arm - lower (elbow to hand)
  { name: 'leftLowerArm', offsetX: -0.45, offsetY: 0.9, offsetZ: 0, scaleX: 0.15, scaleY: 0.35, scaleZ: 0.15, parent: 'leftUpperArm' },
  
  // Right arm - upper (shoulder to elbow)
  { name: 'rightUpperArm', offsetX: 0.45, offsetY: 1.25, offsetZ: 0, scaleX: 0.18, scaleY: 0.35, scaleZ: 0.18, parent: 'torso' },
  // Right arm - lower (elbow to hand)
  { name: 'rightLowerArm', offsetX: 0.45, offsetY: 0.9, offsetZ: 0, scaleX: 0.15, scaleY: 0.35, scaleZ: 0.15, parent: 'rightUpperArm' },
  
  // Left leg - upper (hip to knee)
  { name: 'leftUpperLeg', offsetX: -0.15, offsetY: 0.5, offsetZ: 0, scaleX: 0.22, scaleY: 0.4, scaleZ: 0.22, parent: 'torso' },
  // Left leg - lower (knee to foot)
  { name: 'leftLowerLeg', offsetX: -0.15, offsetY: 0.15, offsetZ: 0, scaleX: 0.2, scaleY: 0.35, scaleZ: 0.2, parent: 'leftUpperLeg' },
  
  // Right leg - upper (hip to knee)
  { name: 'rightUpperLeg', offsetX: 0.15, offsetY: 0.5, offsetZ: 0, scaleX: 0.22, scaleY: 0.4, scaleZ: 0.22, parent: 'torso' },
  // Right leg - lower (knee to foot)
  { name: 'rightLowerLeg', offsetX: 0.15, offsetY: 0.15, offsetZ: 0, scaleX: 0.2, scaleY: 0.35, scaleZ: 0.2, parent: 'rightUpperLeg' },
];

// Number of parts per shombie for instanced rendering
export const PARTS_PER_SHOMBIE = SHOMBIE_BODY_PARTS.length;

/**
 * Generate random twitchiness for a new shombie
 */
export function generatePartTwitches(): Record<string, PartTwitch> {
  const twitchTypes: PartTwitch['twitchType'][] = ['vertical', 'horizontal', 'rotate', 'scale', 'shake'];
  const twitches: Record<string, PartTwitch> = {};
  
  for (const part of SHOMBIE_BODY_PARTS) {
    twitches[part.name] = {
      frequency: 0.5 + Math.random() * 3, // 0.5 to 3.5 Hz
      amplitude: 0.02 + Math.random() * 0.08, // 0.02 to 0.1 intensity
      phaseOffset: Math.random() * Math.PI * 2, // Random phase
      twitchType: twitchTypes[Math.floor(Math.random() * twitchTypes.length)],
    };
  }
  
  return twitches;
}
