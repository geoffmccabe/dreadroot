import * as THREE from 'three';

/**
 * Walapa AI configuration
 */
export interface WalapaAIConfig {
  behaviors?: string[];
  behaviorDescriptions?: Record<string, string>;
  detectionRange?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  angrySpeedMultiplier?: number;
  angryDurationMs?: number;
}

/**
 * Walapa sound configuration
 */
export interface WalapaSoundConfig {
  ambient_sound_url?: string | null;
  call_sound_url?: string | null;
  hurt_sound_url?: string | null;
  volume?: number; // 0-200
}

/**
 * Walapa definition from database - admin-configurable enemy tiers
 * Walapas are floating whale-like creatures that travel between tall trees
 */
export interface WalapaDefinition {
  id: string;
  tier: number;
  name: string;
  body_texture_url: string | null;
  belly_texture_url: string | null;
  eyes_texture_url: string | null;
  speed: number; // Percentage of player walking speed (100 = same as player, 2000 = 20x faster)
  health: number;
  wait_time_seconds: number; // How long to wait at each tree (default 30)
  min_tree_tier: number; // Minimum tree tier to visit (default 10)
  ai_config?: WalapaAIConfig | null; // AI behavior settings
  sound_config?: WalapaSoundConfig | null; // Sound settings
  created_at: string;
  updated_at: string;
}

/**
 * Walapa body part definition - each represents a 1x1x1 block
 */
export interface WalapaPart {
  name: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  textureType: 'body' | 'belly' | 'eyes';
}

/**
 * State of walapa's journey between trees
 */
export type WalapaState = 'waiting' | 'traveling' | 'arriving';

/**
 * Runtime state for an active walapa instance
 */
export interface WalapaInstance {
  id: string;
  definition: WalapaDefinition;
  position: THREE.Vector3;
  rotation: number; // Y rotation in radians
  currentHealth: number;
  maxHealth: number;
  isActive: boolean;
  spawnedAt: number;

  /** Current movement velocity */
  velocity: THREE.Vector3;

  /** Current state in the tree-visiting cycle */
  state: WalapaState;

  /** Current target tree position (top of tree) */
  targetTreePosition: THREE.Vector3 | null;

  /** Tree ID currently targeting or at */
  currentTreeId: string | null;

  /** Time when started waiting at current tree */
  waitStartTime: number;

  /** Bobbing animation phase */
  bobPhase: number;

  /** Tail animation phase */
  tailPhase: number;

  /** Path waypoints for avoiding obstacles */
  pathWaypoints: THREE.Vector3[];

  /** Current waypoint index in path */
  currentWaypointIndex: number;

  /** Scale factor (0.9 to 1.1 for variation) */
  scale: number;

  /** Players currently riding this walapa */
  riders: string[];
}

/**
 * Base dimensions for tier 1 walapa (in blocks/meters)
 * - Length (Z): 10m
 * - Width (X): 7m
 * - Height (Y): ~3m for body
 */
const TIER1_LENGTH = 10;
const TIER1_WIDTH = 7;
const TIER1_HEIGHT = 3;

/**
 * Get size multiplier for a tier
 * Tier 1 = 1.0x, each tier adds 10%
 */
export function getTierSizeMultiplier(tier: number): number {
  return 1.0 + (tier - 1) * 0.1;
}

/**
 * Get dimensions for a specific tier
 */
export function getTierDimensions(tier: number): { length: number; width: number; height: number } {
  const mult = getTierSizeMultiplier(tier);
  return {
    length: Math.round(TIER1_LENGTH * mult),
    width: Math.round(TIER1_WIDTH * mult),
    height: Math.round(TIER1_HEIGHT * mult),
  };
}

/**
 * Generate oval body block positions for a given tier
 * Creates an oval/ellipsoid shape using 1x1x1 blocks
 */
export function generateWalapaBodyBlocks(tier: number): WalapaPart[] {
  const parts: WalapaPart[] = [];
  const dims = getTierDimensions(tier);

  const halfLength = dims.length / 2;
  const halfWidth = dims.width / 2;
  const halfHeight = dims.height / 2;

  // Generate body blocks - ellipsoid shape
  for (let z = -Math.floor(halfLength); z <= Math.floor(halfLength); z++) {
    for (let x = -Math.floor(halfWidth); x <= Math.floor(halfWidth); x++) {
      for (let y = -Math.floor(halfHeight); y <= Math.floor(halfHeight); y++) {
        // Ellipsoid equation: (x/a)^2 + (y/b)^2 + (z/c)^2 <= 1
        const normalizedX = x / halfWidth;
        const normalizedY = y / halfHeight;
        const normalizedZ = z / halfLength;

        const dist = normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ;

        if (dist <= 1.0) {
          // Determine texture type based on position
          let textureType: 'body' | 'belly' | 'eyes' = 'body';

          // Bottom blocks are belly
          if (y < 0) {
            textureType = 'belly';
          }

          parts.push({
            name: `block_${x}_${y}_${z}`,
            offsetX: x,
            offsetY: y,
            offsetZ: z,
            textureType,
          });
        }
      }
    }
  }

  // Add eyes - positioned at front top
  const eyeY = Math.floor(halfHeight * 0.6);
  const eyeX = Math.floor(halfWidth * 0.4);
  const eyeZ = Math.floor(halfLength * 0.8);

  parts.push({
    name: 'leftEye',
    offsetX: -eyeX,
    offsetY: eyeY,
    offsetZ: eyeZ,
    textureType: 'eyes',
  });

  parts.push({
    name: 'rightEye',
    offsetX: eyeX,
    offsetY: eyeY,
    offsetZ: eyeZ,
    textureType: 'eyes',
  });

  // Add tail blocks - behind the body
  const tailStartZ = -Math.floor(halfLength) - 1;

  // Tail base - 3 blocks wide, extends back
  for (let tz = tailStartZ; tz >= tailStartZ - 2; tz--) {
    const tailWidth = Math.max(1, 3 - Math.abs(tz - tailStartZ));
    for (let tx = -Math.floor(tailWidth / 2); tx <= Math.floor(tailWidth / 2); tx++) {
      parts.push({
        name: `tail_${tx}_${tz}`,
        offsetX: tx,
        offsetY: 0,
        offsetZ: tz,
        textureType: 'body',
      });
    }
  }

  // Tail flukes - spread out at the end
  const flukeZ = tailStartZ - 3;
  parts.push({
    name: 'leftFluke1',
    offsetX: -2,
    offsetY: 0,
    offsetZ: flukeZ,
    textureType: 'body',
  });
  parts.push({
    name: 'leftFluke2',
    offsetX: -3,
    offsetY: 0,
    offsetZ: flukeZ - 1,
    textureType: 'body',
  });
  parts.push({
    name: 'rightFluke1',
    offsetX: 2,
    offsetY: 0,
    offsetZ: flukeZ,
    textureType: 'body',
  });
  parts.push({
    name: 'rightFluke2',
    offsetX: 3,
    offsetY: 0,
    offsetZ: flukeZ - 1,
    textureType: 'body',
  });

  return parts;
}

/**
 * Pre-generated body parts for tier 1 (for backwards compatibility)
 * The actual block positions are generated dynamically per tier
 */
export const WALAPA_BODY_PARTS: WalapaPart[] = generateWalapaBodyBlocks(1);

// Number of parts is dynamic based on tier
export const PARTS_PER_WALAPA = WALAPA_BODY_PARTS.length;

/**
 * Tier colors for the 10 walapa tiers
 */
export const WALAPA_TIER_COLORS: Record<number, string> = {
  1: '#9ca3af',   // Grey (common)
  2: '#22c55e',   // Green (uncommon)
  3: '#3b82f6',   // Blue (rare)
  4: '#a855f7',   // Purple (epic)
  5: '#f59e0b',   // Gold (legendary)
  6: '#ffffff',   // White (divine)
  7: '#ec4899',   // Pink (mystic)
  8: '#ff6b6b',   // Coral (rainbow)
  9: '#1a1a1a',   // Dark (apocalyptic)
  10: '#ffd700',  // Bright gold (cosmic)
};
