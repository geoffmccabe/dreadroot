import * as THREE from 'three';
import type { StrikeState } from '@/features/enemies/striking/strikeAnimation';

/**
 * Shroomer definition from database - admin-configurable enemy tiers.
 * Cloned from ShombieDefinition (identical shape).
 */
export interface ShroomerDefinition {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  texture_url_ktx2?: string | null;
  texture_tier?: 'standard' | 'premium';
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
 * Body part definition for block-based shroomer
 */
export interface ShroomerPart {
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
 * Fire effect attached to a body part
 */
export interface ShroomerBodyFire {
  partName: string;
  startTime: number;
  duration: number; // ms
  colors: string[];
}

/**
 * Runtime state for an active shroomer instance
 */
export interface ShroomerInstance extends StrikeState {
  id: string;
  definition: ShroomerDefinition;
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
  /** Last time this shroomer attacked */
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
  /** Stun end time (ms timestamp) - shroomer doesn't move while stunned */
  stunUntil?: number;
  // ── Blast tumble (ragdoll-lite): spin in the air, land rotated, slide, wait,
  //    then rise upright and resume. All time-driven so the renderer can
  //    compute the orientation smoothly each frame from these fields.
  /** True while tumbling from a blast (skips AI movement). */
  isTumbling?: boolean;
  /** Unit spin axis (random per launch). */
  tumbleAxisX?: number;
  tumbleAxisY?: number;
  tumbleAxisZ?: number;
  /** Spin rate (rad/s). */
  tumbleRate?: number;
  /** Launch timestamp (ms). */
  tumbleLaunchAt?: number;
  /** Landing timestamp (ms); 0 = still airborne. */
  tumbleLandedAt?: number;
  /** Dead-but-still-flying ragdoll: a blast-killed shroomer that tumbles through
   *  the air, then despawns when the tumble completes (not interactive). */
  isCorpse?: boolean;
  /** Headshot-kill fragmentation: cap launches straight up, body parts fly out
   *  horizontally. Renderer drives the part physics; despawns after a timeout. */
  isExploding?: boolean;
  explodeStartTime?: number;
  /** Random seed (radians) so each part flies a deterministic random direction. */
  explodeSeed?: number;
  /** Momentum scale for the fragmentation (1.0 = headshot/grenade, 0.9 = a
   *  lower-energy inter-enemy melee kill). */
  explodeMomentum?: number;
  /** Active fires on body parts */
  bodyFires: ShroomerBodyFire[];
}

/**
 * Shroomer body structure - humanoid made of parts with joints.
 * Same layout as Shombie (so total height + part dimensions match);
 * only the rendered GEOMETRY differs (cylinders / sphere / cap).
 * All offsets are relative to the base position (feet).
 */
export const SHROOMER_BODY_PARTS: ShroomerPart[] = [
  // Head (will render as a sphere; cap embeds its top third)
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

// Number of parts per shroomer for instanced rendering
export const PARTS_PER_SHROOMER = SHROOMER_BODY_PARTS.length;

/**
 * Generate random twitchiness for a new shroomer
 */
export function generatePartTwitches(): Record<string, PartTwitch> {
  const twitchTypes: PartTwitch['twitchType'][] = ['vertical', 'horizontal', 'rotate', 'scale', 'shake'];
  const twitches: Record<string, PartTwitch> = {};

  for (const part of SHROOMER_BODY_PARTS) {
    twitches[part.name] = {
      frequency: 0.5 + Math.random() * 3, // 0.5 to 3.5 Hz
      amplitude: 0.02 + Math.random() * 0.08, // 0.02 to 0.1 intensity
      phaseOffset: Math.random() * Math.PI * 2, // Random phase
      twitchType: twitchTypes[Math.floor(Math.random() * twitchTypes.length)],
    };
  }

  return twitches;
}
