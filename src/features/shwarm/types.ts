import * as THREE from 'three';

/**
 * Shwarm definition from database - admin-configurable enemy tiers
 */
export interface ShwarmDefinition {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  speed: number; // blocks per second
  min_blocks: number;
  max_blocks: number;
  health_per_block: number;
  damage_per_hit: number;
  spawn_chance_per_minute: number;
  x_factor: number; // random movement variance (1-10)
  created_at: string;
  updated_at: string;
  /** AI behavior configuration (from database) */
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    angrySpeedMultiplier?: number;
    angryDurationMs?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

/**
 * Individual shwarm block state (runtime, not stored per-frame in DB)
 */
export interface ShwarmBlock {
  id: string;
  shwarmId: string;
  blockIndex: number;
  position: THREE.Vector3;
  currentHealth: number;
  maxHealth: number;
  isAlive: boolean;
  /** Visual scale based on health (0.2 to 1.0), hitbox stays constant */
  scale: number;
  /** Debounce for player collision */
  lastHitPlayerAt: number | null;
}

/**
 * Active shwarm instance (server-synced)
 */
export interface ActiveShwarm {
  id: string;
  worldId: string;
  definition: ShwarmDefinition;
  authorityUserId: string | null;
  spawnedAt: string;
  isActive: boolean;
}

/**
 * Database row types (snake_case from Supabase)
 */
export interface ShwarmDefinitionRow {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  speed: number;
  min_blocks: number;
  max_blocks: number;
  health_per_block: number;
  damage_per_hit: number;
  spawn_chance_per_minute: number;
  x_factor: number;
  created_at: string;
  updated_at: string;
  /** AI behavior configuration (from database) */
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    angrySpeedMultiplier?: number;
    angryDurationMs?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

export interface ActiveShwarmRow {
  id: string;
  world_id: string;
  definition_id: string;
  authority_user_id: string | null;
  state_json: Record<string, unknown> | null;
  killer_user_id: string | null;
  spawned_at: string;
  is_active: boolean;
}

export interface ShwarmBlockRow {
  id: string;
  shwarm_id: string;
  block_index: number;
  initial_x: number;
  initial_y: number;
  initial_z: number;
  current_health: number;
  max_health: number;
  last_hit_by: string | null;
  last_hit_at: string | null;
  is_alive: boolean;
}

/**
 * Broadcast event payloads for multiplayer sync
 */
export interface ShwarmSpawnedPayload {
  shwarmId: string;
  tier: number;
  definition: ShwarmDefinition;
  blocks: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    hp: number;
    maxHp: number;
  }>;
  authorityUserId: string;
  seed: number;
}

export interface ShwarmSnapshotPayload {
  shwarmId: string;
  t: number; // timestamp
  blocks: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    scale: number;
    hp: number;
  }>;
}

export interface ShwarmHitPayload {
  shwarmId: string;
  blockId: string;
  hp: number;
  lastHitBy: string;
}

export interface ShwarmDestroyedPayload {
  shwarmId: string;
  killerUserId: string;
}

/**
 * User combat stats for kill tracking
 */
export interface UserCombatStats {
  id: string;
  userId: string;
  enemyType: string;
  kills: number;
  createdAt: string;
  updatedAt: string;
}
