/**
 * Enemy Spawner Integration
 *
 * Bridges the Universal Enemy Spawner with the actual enemy systems (Shwarm, Shombie, etc.)
 * Builds spawn rules from definitions and handles spawn callbacks.
 */

import { useMemo, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import {
  useUniversalEnemySpawner,
  createSpawnRule,
  EnemySpawnRule,
  SpawnRequest,
} from './useUniversalEnemySpawner';
import type { ShwarmDefinition } from '@/features/shwarm/types';
import type { ShombieDefinition, ShombieInstance } from '@/features/shombie/types';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
import { SHWARM_SPAWN_BOUNDS } from '@/features/shwarm/constants';
import { SHOMBIE_SPAWN_BOUNDS, MAX_SHOMBIES_PER_CHUNK, MAX_TOTAL_SHOMBIES, CHUNK_SIZE } from '@/features/shombie/constants';

/**
 * Options for the enemy spawner integration
 */
export interface UseEnemySpawnerIntegrationOptions {
  /** Is the spawner enabled globally? */
  isEnabled: boolean;

  /** Camera ref for player position */
  cameraRef: React.RefObject<THREE.Camera>;

  /** Current day/night state from cycle */
  isNight: boolean;

  /** Player's current level */
  playerLevel: number;

  /** Is player currently in a tree? (placeholder - implement when tree detection exists) */
  isPlayerInTree?: boolean;

  /** Is player on the ground? (from controls) */
  isPlayerOnGround?: boolean;

  // === Shwarm system ===
  shwarmDefinitions?: ShwarmDefinition[];
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  onSpawnShwarm?: (definition: ShwarmDefinition, worldX: number, worldZ: number) => void;

  // === Shombie system ===
  shombieDefinitions?: ShombieDefinition[];
  shombiesRef: React.RefObject<ShombieInstance[]>;
  onSpawnShombie?: (definition: ShombieDefinition, worldX: number, worldZ: number) => void;
}

/**
 * Hook that integrates the Universal Enemy Spawner with actual enemy systems
 */
export function useEnemySpawnerIntegration({
  isEnabled,
  cameraRef,
  isNight,
  playerLevel,
  isPlayerInTree = false,
  isPlayerOnGround = true,
  shwarmDefinitions,
  shwarmsRef,
  onSpawnShwarm,
  shombieDefinitions,
  shombiesRef,
  onSpawnShombie,
}: UseEnemySpawnerIntegrationOptions) {
  // Store definitions in refs for callback access
  const shwarmDefsRef = useRef(shwarmDefinitions);
  const shombieDefsRef = useRef(shombieDefinitions);
  const onSpawnShwarmRef = useRef(onSpawnShwarm);
  const onSpawnShombieRef = useRef(onSpawnShombie);

  useEffect(() => { shwarmDefsRef.current = shwarmDefinitions; }, [shwarmDefinitions]);
  useEffect(() => { shombieDefsRef.current = shombieDefinitions; }, [shombieDefinitions]);
  useEffect(() => { onSpawnShwarmRef.current = onSpawnShwarm; }, [onSpawnShwarm]);
  useEffect(() => { onSpawnShombieRef.current = onSpawnShombie; }, [onSpawnShombie]);

  /**
   * Build spawn rules from Shwarm and Shombie definitions
   */
  const spawnRules = useMemo((): EnemySpawnRule[] => {
    const rules: EnemySpawnRule[] = [];

    // === SHWARM RULES ===
    // Shwarms spawn any time, anywhere, at any level
    // Use lower limits to prevent overwhelming spawns
    if (shwarmDefinitions) {
      for (const def of shwarmDefinitions) {
        // Higher tiers have lower max active counts
        const tierMaxActive = Math.max(1, 5 - Math.floor(def.tier / 2));

        rules.push(createSpawnRule('shwarm', `Shwarm T${def.tier}`, def.tier, {
          // Shwarms use their spawn_chance_per_minute from definition
          spawnChancePerMinute: def.spawn_chance_per_minute,
          // Limit per tier: T1-2=5, T3-4=4, T5-6=3, T7-8=2, T9-10=1
          maxActive: tierMaxActive,
          maxPerChunk: 1,
          // Spawn 2-6 chunks away from player
          minChunkDistanceFromPlayer: 2,
          maxChunkDistanceFromPlayer: 6,
          // Use shwarm spawn bounds
          spawnBounds: {
            minX: SHWARM_SPAWN_BOUNDS.minX,
            maxX: SHWARM_SPAWN_BOUNDS.maxX,
            minY: SHWARM_SPAWN_BOUNDS.minY,
            maxY: SHWARM_SPAWN_BOUNDS.maxY,
            minZ: SHWARM_SPAWN_BOUNDS.minZ,
            maxZ: SHWARM_SPAWN_BOUNDS.maxZ,
          },
          // Store definition ID for spawn callback
          customData: { definitionId: def.id },
        }));
      }
    }

    // === SHOMBIE RULES ===
    // Shombies spawn at night, on ground, chase player
    // spawn_chance_per_minute is the TOTAL chance per minute (e.g., 2.0 = 2% per minute)
    // Use lower limits to prevent overwhelming spawns
    if (shombieDefinitions) {
      for (const def of shombieDefinitions) {
        // Higher tiers have lower max active counts
        const tierMaxActive = Math.max(1, 4 - Math.floor(def.tier / 3));

        rules.push(createSpawnRule('shombie', `Shombie T${def.tier}`, def.tier, {
          // Use definition's spawn rate directly - UES handles the per-second conversion
          spawnChancePerMinute: def.spawn_chance_per_minute,
          // Night only for natural spawning (can be overridden)
          timeOfDay: 'any', // Start with 'any' for testing, change to 'night' for production
          // Limit per tier: T1-2=4, T3-5=3, T6-8=2, T9-10=1
          maxActive: tierMaxActive,
          maxPerChunk: 1,
          // Spawn 2-4 chunks away from player (not too close, not too far)
          minChunkDistanceFromPlayer: 2,
          maxChunkDistanceFromPlayer: 4,
          // Use shombie spawn bounds
          spawnBounds: {
            minX: SHOMBIE_SPAWN_BOUNDS.minX,
            maxX: SHOMBIE_SPAWN_BOUNDS.maxX,
            minY: SHOMBIE_SPAWN_BOUNDS.minY,
            maxY: SHOMBIE_SPAWN_BOUNDS.maxY,
            minZ: SHOMBIE_SPAWN_BOUNDS.minZ,
            maxZ: SHOMBIE_SPAWN_BOUNDS.maxZ,
          },
          // Store definition ID for spawn callback
          customData: { definitionId: def.id },
        }));
      }
    }

    console.log(`[EnemySpawnerIntegration] Built ${rules.length} spawn rules`);
    return rules;
  }, [shwarmDefinitions, shombieDefinitions]);

  /**
   * Get active count for an enemy type and tier
   */
  const getActiveCount = useCallback((enemyType: string, tier: number): number => {
    if (enemyType === 'shwarm') {
      const shwarms = shwarmsRef.current || [];
      return shwarms.filter(s => s.isActive && s.definition.tier === tier).length;
    }

    if (enemyType === 'shombie') {
      const shombies = shombiesRef.current || [];
      return shombies.filter(s => s.isActive && s.definition.tier === tier).length;
    }

    return 0;
  }, [shwarmsRef, shombiesRef]);

  /**
   * Get count in a specific chunk for an enemy type and tier
   */
  const getChunkCount = useCallback((enemyType: string, tier: number, chunkX: number, chunkZ: number): number => {
    if (enemyType === 'shwarm') {
      const shwarms = shwarmsRef.current || [];
      // Shwarms don't track spawn chunk, so count by position
      return shwarms.filter(s => {
        if (!s.isActive || s.definition.tier !== tier) return false;
        // Use first block position as reference
        if (s.blocks.length === 0) return false;
        const pos = s.blocks[0].position;
        const cx = Math.floor(pos.x / CHUNK_SIZE);
        const cz = Math.floor(pos.z / CHUNK_SIZE);
        return cx === chunkX && cz === chunkZ;
      }).length;
    }

    if (enemyType === 'shombie') {
      const shombies = shombiesRef.current || [];
      return shombies.filter(s =>
        s.isActive &&
        s.definition.tier === tier &&
        s.spawnChunkX === chunkX &&
        s.spawnChunkZ === chunkZ
      ).length;
    }

    return 0;
  }, [shwarmsRef, shombiesRef]);

  /**
   * Handle spawn request from UES
   */
  const handleSpawnEnemy = useCallback((request: SpawnRequest) => {
    const { enemyType, tier, worldX, worldZ, customData } = request;

    if (enemyType === 'shwarm') {
      const defs = shwarmDefsRef.current;
      const spawn = onSpawnShwarmRef.current;
      if (!defs || !spawn) return;

      const def = defs.find(d => d.tier === tier);
      if (!def) {
        console.warn(`[EnemySpawnerIntegration] No shwarm definition for tier ${tier}`);
        return;
      }

      console.log(`[UES] Spawning shwarm tier ${tier} at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
      spawn(def, worldX, worldZ);
    }

    if (enemyType === 'shombie') {
      const defs = shombieDefsRef.current;
      const spawn = onSpawnShombieRef.current;
      if (!defs || !spawn) return;

      const def = defs.find(d => d.tier === tier);
      if (!def) {
        console.warn(`[EnemySpawnerIntegration] No shombie definition for tier ${tier}`);
        return;
      }

      console.log(`[UES] Spawning shombie tier ${tier} at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
      spawn(def, worldX, worldZ);
    }
  }, []);

  // Use the Universal Enemy Spawner
  const { performSpawnCheck } = useUniversalEnemySpawner({
    isEnabled,
    cameraRef,
    isNight,
    playerLevel,
    isPlayerInTree,
    isPlayerOnGround,
    spawnRules,
    getActiveCount,
    getChunkCount,
    onSpawnEnemy: handleSpawnEnemy,
  });

  return {
    spawnRules,
    performSpawnCheck,
  };
}
