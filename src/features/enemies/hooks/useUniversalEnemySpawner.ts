/**
 * Universal Enemy Spawner (UES)
 *
 * A single, efficient system for spawning all enemy types based on configurable rules.
 * Designed to handle 100+ enemy types without causing frame drops.
 *
 * Features:
 * - Runs spawn checks every 1 second
 * - Early termination for enemies that don't meet basic criteria
 * - Supports conditions: time of day, player location, distance from origin, player level
 * - Efficient batch processing with minimal allocations
 */

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

// Spawn check interval - 1 second as requested
const SPAWN_CHECK_INTERVAL_MS = 1000;

// Chunk size for spawn calculations
const CHUNK_SIZE = 16;

/**
 * Time of day condition
 */
export type TimeOfDayCondition = 'day' | 'night' | 'any';

/**
 * Player location condition
 */
export type PlayerLocationCondition = 'ground' | 'tree' | 'air' | 'any';

/**
 * Spawn rule for an enemy type
 * Each enemy type registers its spawn rules with the UES
 */
export interface EnemySpawnRule {
  /** Unique identifier for this enemy type */
  enemyType: string;

  /** Human-readable name for logging */
  displayName: string;

  /** Is spawning enabled for this enemy type? */
  enabled: boolean;

  // === Quick elimination conditions (checked first, very fast) ===

  /** Time of day requirement */
  timeOfDay: TimeOfDayCondition;

  /** Player location requirement */
  playerLocation: PlayerLocationCondition;

  /** Minimum distance from world origin (0,0,0) - 0 means no minimum */
  minDistanceFromOrigin: number;

  /** Maximum distance from world origin - Infinity means no maximum */
  maxDistanceFromOrigin: number;

  /** Minimum player level required - 0 means no minimum */
  minPlayerLevel: number;

  /** Maximum player level - Infinity means no maximum */
  maxPlayerLevel: number;

  // === Spawn rate and limits ===

  /** Base spawn chance per minute (from definition) */
  spawnChancePerMinute: number;

  /** Maximum active instances of this enemy type */
  maxActive: number;

  /** Maximum per chunk (for chunk-based spawning) */
  maxPerChunk: number;

  /** Minimum distance from player to spawn (chunks) */
  minChunkDistanceFromPlayer: number;

  /** Maximum distance from player to spawn (chunks) */
  maxChunkDistanceFromPlayer: number;

  // === Spawn bounds ===

  /** Spawn bounds in world coordinates */
  spawnBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };

  // === Tier-specific data ===

  /** Tier of this enemy (1-10) */
  tier: number;

  /** Any additional data needed by the spawn callback */
  customData?: Record<string, unknown>;
}

/**
 * Result of a spawn check - tells the spawner what to spawn
 */
export interface SpawnRequest {
  enemyType: string;
  tier: number;
  worldX: number;
  worldZ: number;
  chunkX: number;
  chunkZ: number;
  customData?: Record<string, unknown>;
}

/**
 * Callback to get current count of active enemies by type
 */
export type GetActiveCountFn = (enemyType: string, tier: number) => number;

/**
 * Callback to get count in a specific chunk
 */
export type GetChunkCountFn = (enemyType: string, tier: number, chunkX: number, chunkZ: number) => number;

/**
 * Callback to actually spawn an enemy
 */
export type SpawnEnemyFn = (request: SpawnRequest) => void;

/**
 * Options for the Universal Enemy Spawner hook
 */
export interface UseUniversalEnemySpawnerOptions {
  /** Is the spawner enabled? */
  isEnabled: boolean;

  /** Camera ref for player position */
  cameraRef: React.RefObject<THREE.Camera>;

  /** Current day/night state */
  isNight: boolean;

  /** Player's current level */
  playerLevel: number;

  /** Is player currently in a tree? */
  isPlayerInTree: boolean;

  /** Is player on the ground? */
  isPlayerOnGround: boolean;

  /** Registered spawn rules for all enemy types */
  spawnRules: EnemySpawnRule[];

  /** Callback to get active count */
  getActiveCount: GetActiveCountFn;

  /** Callback to get chunk count */
  getChunkCount: GetChunkCountFn;

  /** Callback to spawn an enemy */
  onSpawnEnemy: SpawnEnemyFn;
}

// Pre-allocated for performance
const _playerPos = new THREE.Vector3();

/**
 * Universal Enemy Spawner Hook
 *
 * Efficiently processes spawn rules for all enemy types every second.
 * Uses early termination to skip enemies that don't meet basic criteria.
 */
export function useUniversalEnemySpawner({
  isEnabled,
  cameraRef,
  isNight,
  playerLevel,
  isPlayerInTree,
  isPlayerOnGround,
  spawnRules,
  getActiveCount,
  getChunkCount,
  onSpawnEnemy,
}: UseUniversalEnemySpawnerOptions) {
  // Refs for values that change frequently (avoid recreating interval)
  const isNightRef = useRef(isNight);
  const playerLevelRef = useRef(playerLevel);
  const isPlayerInTreeRef = useRef(isPlayerInTree);
  const isPlayerOnGroundRef = useRef(isPlayerOnGround);
  const spawnRulesRef = useRef(spawnRules);
  const getActiveCountRef = useRef(getActiveCount);
  const getChunkCountRef = useRef(getChunkCount);
  const onSpawnEnemyRef = useRef(onSpawnEnemy);

  // Keep refs in sync
  useEffect(() => { isNightRef.current = isNight; }, [isNight]);
  useEffect(() => { playerLevelRef.current = playerLevel; }, [playerLevel]);
  useEffect(() => { isPlayerInTreeRef.current = isPlayerInTree; }, [isPlayerInTree]);
  useEffect(() => { isPlayerOnGroundRef.current = isPlayerOnGround; }, [isPlayerOnGround]);
  useEffect(() => { spawnRulesRef.current = spawnRules; }, [spawnRules]);
  useEffect(() => { getActiveCountRef.current = getActiveCount; }, [getActiveCount]);
  useEffect(() => { getChunkCountRef.current = getChunkCount; }, [getChunkCount]);
  useEffect(() => { onSpawnEnemyRef.current = onSpawnEnemy; }, [onSpawnEnemy]);

  /**
   * Check if a rule passes the quick elimination conditions
   * These are O(1) checks that can filter out most enemies immediately
   */
  const passesQuickChecks = useCallback((
    rule: EnemySpawnRule,
    isNight: boolean,
    playerLevel: number,
    isInTree: boolean,
    isOnGround: boolean,
    distanceFromOrigin: number
  ): boolean => {
    // Check if enabled
    if (!rule.enabled) return false;

    // Time of day check
    if (rule.timeOfDay !== 'any') {
      if (rule.timeOfDay === 'night' && !isNight) return false;
      if (rule.timeOfDay === 'day' && isNight) return false;
    }

    // Player location check
    if (rule.playerLocation !== 'any') {
      if (rule.playerLocation === 'tree' && !isInTree) return false;
      if (rule.playerLocation === 'ground' && !isOnGround) return false;
      if (rule.playerLocation === 'air' && (isOnGround || isInTree)) return false;
    }

    // Distance from origin check
    if (rule.minDistanceFromOrigin > 0 && distanceFromOrigin < rule.minDistanceFromOrigin) return false;
    if (rule.maxDistanceFromOrigin < Infinity && distanceFromOrigin > rule.maxDistanceFromOrigin) return false;

    // Player level check
    if (rule.minPlayerLevel > 0 && playerLevel < rule.minPlayerLevel) return false;
    if (rule.maxPlayerLevel < Infinity && playerLevel > rule.maxPlayerLevel) return false;

    return true;
  }, []);

  /**
   * Main spawn check - runs every second
   *
   * IMPORTANT: spawn_chance_per_minute is the TOTAL chance per minute for this enemy type.
   * For example, 2.0 means 2% chance per minute that ONE enemy spawns somewhere nearby.
   * We roll ONCE per rule, then pick a random valid chunk if successful.
   */
  const performSpawnCheck = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    // Get current state from refs
    const rules = spawnRulesRef.current;
    const isNight = isNightRef.current;
    const playerLevel = playerLevelRef.current;
    const isInTree = isPlayerInTreeRef.current;
    const isOnGround = isPlayerOnGroundRef.current;
    const getActive = getActiveCountRef.current;
    const getChunk = getChunkCountRef.current;
    const spawn = onSpawnEnemyRef.current;

    // Get player position via canonical snapshot — post-L2 this is reconciled server state.
    const snap = getLocalPlayerSnapshot();
    _playerPos.set(snap.x, snap.y, snap.z);
    const playerChunkX = Math.floor(_playerPos.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(_playerPos.z / CHUNK_SIZE);
    const distanceFromOrigin = Math.sqrt(_playerPos.x * _playerPos.x + _playerPos.z * _playerPos.z);

    // Process each spawn rule
    for (const rule of rules) {
      // === PHASE 1: Quick elimination (O(1) checks) ===
      if (!passesQuickChecks(rule, isNight, playerLevel, isInTree, isOnGround, distanceFromOrigin)) {
        continue;
      }

      // === PHASE 2: Active count check (per-tier) ===
      const activeCount = getActive(rule.enemyType, rule.tier);
      if (activeCount >= rule.maxActive) {
        continue;
      }

      // === PHASE 2B: Total count check (across all tiers) ===
      // Limit total shwarms to 15, total shombies to 10
      let totalCount = 0;
      for (let t = 1; t <= 10; t++) {
        totalCount += getActive(rule.enemyType, t);
      }
      const maxTotal = rule.enemyType === 'shwarm' ? 15 : 10;
      if (totalCount >= maxTotal) {
        continue;
      }

      // === PHASE 3: Single spawn roll per rule ===
      // Convert per-minute PERCENTAGE to per-second decimal:
      // spawnChancePerMinute=2.0 means "2% per minute" = 0.02/60 = 0.000333 per second
      const chancePerSecond = (rule.spawnChancePerMinute / 100) / 60;

      // Roll ONCE for this rule - this is the TOTAL spawn chance
      if (Math.random() >= chancePerSecond) {
        continue; // No spawn this second for this rule
      }

      // === PHASE 4: Find a valid chunk to spawn in ===
      const minDist = rule.minChunkDistanceFromPlayer;
      const maxDist = rule.maxChunkDistanceFromPlayer;

      // Build list of valid chunks (not at capacity)
      const validChunks: { x: number; z: number; dist: number }[] = [];

      for (let dx = -maxDist; dx <= maxDist; dx++) {
        for (let dz = -maxDist; dz <= maxDist; dz++) {
          const chunkDist = Math.max(Math.abs(dx), Math.abs(dz));
          if (chunkDist < minDist || chunkDist > maxDist) continue;

          const chunkX = playerChunkX + dx;
          const chunkZ = playerChunkZ + dz;

          // Check chunk capacity
          const chunkCount = getChunk(rule.enemyType, rule.tier, chunkX, chunkZ);
          if (chunkCount >= rule.maxPerChunk) continue;

          validChunks.push({ x: chunkX, z: chunkZ, dist: chunkDist });
        }
      }

      if (validChunks.length === 0) {
        continue; // No valid chunks available
      }

      // Weight chunks by distance (closer chunks slightly more likely)
      // But keep it relatively even - just pick randomly for simplicity
      const selectedChunk = validChunks[Math.floor(Math.random() * validChunks.length)];

      // Calculate world position within selected chunk
      const worldX = selectedChunk.x * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
      const worldZ = selectedChunk.z * CHUNK_SIZE + Math.random() * CHUNK_SIZE;

      // Clamp to spawn bounds
      const clampedX = Math.max(rule.spawnBounds.minX, Math.min(rule.spawnBounds.maxX, worldX));
      const clampedZ = Math.max(rule.spawnBounds.minZ, Math.min(rule.spawnBounds.maxZ, worldZ));

      // Request spawn
      spawn({
        enemyType: rule.enemyType,
        tier: rule.tier,
        worldX: clampedX,
        worldZ: clampedZ,
        chunkX: selectedChunk.x,
        chunkZ: selectedChunk.z,
        customData: rule.customData,
      });
    }
  }, [cameraRef, passesQuickChecks]);

  // Main spawn loop - runs every second
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    console.log('[UES] Universal Enemy Spawner started');

    // Initial check after short delay
    const initialTimer = setTimeout(performSpawnCheck, 500);

    // Regular interval
    const interval = setInterval(performSpawnCheck, SPAWN_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      console.log('[UES] Universal Enemy Spawner stopped');
    };
  }, [isEnabled, performSpawnCheck]);

  return {
    // Expose for manual trigger if needed
    performSpawnCheck,
  };
}

/**
 * Helper to create a spawn rule with sensible defaults
 */
export function createSpawnRule(
  enemyType: string,
  displayName: string,
  tier: number,
  overrides: Partial<EnemySpawnRule> = {}
): EnemySpawnRule {
  return {
    enemyType,
    displayName,
    tier,
    enabled: true,
    timeOfDay: 'any',
    playerLocation: 'any',
    minDistanceFromOrigin: 0,
    maxDistanceFromOrigin: Infinity,
    minPlayerLevel: 0,
    maxPlayerLevel: Infinity,
    spawnChancePerMinute: 1,
    maxActive: 10,
    maxPerChunk: 3,
    minChunkDistanceFromPlayer: 1,
    maxChunkDistanceFromPlayer: 5,
    spawnBounds: {
      minX: -200,
      maxX: 200,
      minY: 0,
      maxY: 50,
      minZ: -200,
      maxZ: 200,
    },
    ...overrides,
  };
}
