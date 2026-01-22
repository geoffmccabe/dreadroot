import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShwarmDefinition, ShwarmBlock, ActiveShwarm } from '../types';
import { SHWARM_SPAWN_BOUNDS, MAX_SHWARM_BLOCKS } from '../constants';

/**
 * Runtime state for an active shwarm
 */
export interface ShwarmInstance {
  id: string;
  definition: ShwarmDefinition;
  blocks: ShwarmBlock[];
  spawnedAt: number;
  isActive: boolean;
  /** Seed for deterministic random movement */
  seed: number;
}

interface UseShwarmSystemOptions {
  definitions: ShwarmDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  blocksRef: React.RefObject<{ position_x: number; position_y: number; position_z: number }[]>;
  isEnabled: boolean;
  onGroupKilled?: (tier: number) => void; // Called when all blocks in a shwarm group are killed, passes tier
}

// Pre-allocated vectors for spawning calculations
const _rayDir = new THREE.Vector3();
const _spawnPos = new THREE.Vector3();

/**
 * Hook to manage active shwarms with keyboard spawner
 * Sequence: "!" then "1" (shwarm type) then "1-0" (tier) within 3 seconds
 */
export function useShwarmSystem({
  definitions,
  cameraRef,
  blocksRef,
  isEnabled,
  onGroupKilled,
}: UseShwarmSystemOptions) {
  const [shwarms, setShwarms] = useState<ShwarmInstance[]>([]);
  const shwarmsRef = useRef<ShwarmInstance[]>([]);
  
  // Keep ref in sync for frame loop access
  useEffect(() => {
    shwarmsRef.current = shwarms;
  }, [shwarms]);

  /**
   * Generate spawn position in front of player using raycast direction
   */
  const calculateSpawnPosition = useCallback((): THREE.Vector3 | null => {
    const camera = cameraRef.current;
    if (!camera) return null;

    // Get direction player is looking
    _rayDir.set(0, 0, -1);
    _rayDir.applyQuaternion(camera.quaternion);
    _rayDir.normalize();

    // Spawn 8-12 blocks in front of player
    const distance = 8 + Math.random() * 4;
    _spawnPos.copy(camera.position);
    _spawnPos.addScaledVector(_rayDir, distance);

    // Clamp to spawn bounds
    _spawnPos.x = Math.max(SHWARM_SPAWN_BOUNDS.minX, Math.min(SHWARM_SPAWN_BOUNDS.maxX, _spawnPos.x));
    _spawnPos.z = Math.max(SHWARM_SPAWN_BOUNDS.minZ, Math.min(SHWARM_SPAWN_BOUNDS.maxZ, _spawnPos.z));
    _spawnPos.y = Math.max(SHWARM_SPAWN_BOUNDS.minY, Math.min(SHWARM_SPAWN_BOUNDS.maxY, _spawnPos.y));

    return _spawnPos.clone();
  }, [cameraRef]);

  /**
   * Spawn a shwarm with the given definition
   */
  const spawnShwarm = useCallback((definition: ShwarmDefinition): ShwarmInstance | null => {
    const spawnPos = calculateSpawnPosition();
    if (!spawnPos) return null;

    const id = `shwarm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const seed = Math.floor(Math.random() * 1000000);

    // Calculate block count
    const blockCount = Math.floor(
      definition.min_blocks + Math.random() * (definition.max_blocks - definition.min_blocks)
    );
    const actualBlockCount = Math.min(blockCount, MAX_SHWARM_BLOCKS);

    // Generate blocks in a cluster around spawn position
    const blocks: ShwarmBlock[] = [];
    for (let i = 0; i < actualBlockCount; i++) {
      // Spread blocks in a loose cluster (2-3 block radius)
      const offsetX = (Math.random() - 0.5) * 4;
      const offsetY = (Math.random() - 0.5) * 2 + 1; // bias upward
      const offsetZ = (Math.random() - 0.5) * 4;

      const blockId = `${id}_block_${i}`;
      blocks.push({
        id: blockId,
        shwarmId: id,
        blockIndex: i,
        position: new THREE.Vector3(
          spawnPos.x + offsetX,
          spawnPos.y + offsetY,
          spawnPos.z + offsetZ
        ),
        currentHealth: definition.health_per_block,
        maxHealth: definition.health_per_block,
        isAlive: true,
        scale: 1.0,
        lastHitPlayerAt: null,
      });
    }

    const instance: ShwarmInstance = {
      id,
      definition,
      blocks,
      spawnedAt: Date.now(),
      isActive: true,
      seed,
    };

    // Update ref synchronously first, then state
    shwarmsRef.current = [...shwarmsRef.current, instance];
    setShwarms(shwarmsRef.current);
    console.log(`[Shwarm] Spawned tier ${definition.tier} shwarm with ${actualBlockCount} blocks at`, spawnPos);

    return instance;
  }, [calculateSpawnPosition]);

  /**
   * Remove a shwarm instance
   */
  const removeShwarm = useCallback((shwarmId: string) => {
    // Update ref synchronously first, then state
    shwarmsRef.current = shwarmsRef.current.filter(s => s.id !== shwarmId);
    setShwarms(shwarmsRef.current);
  }, []);

  /**
   * Damage a specific block
   * @returns Object with wasKilled flag and actualDamage dealt (capped at remaining health)
   */
  const damageBlock = useCallback((shwarmId: string, blockId: string, damage: number): { wasKilled: boolean; actualDamage: number } => {
    // First, synchronously look up the block's current health from the ref
    // This ensures we return the correct actualDamage before state updates
    let wasKilled = false;
    let actualDamage = 0;
    
    const currentShwarms = shwarmsRef.current;
    const targetShwarm = currentShwarms.find(s => s.id === shwarmId);
    
    if (targetShwarm) {
      const targetBlock = targetShwarm.blocks.find(b => b.id === blockId && b.isAlive);
      if (targetBlock) {
        // Calculate actual damage (capped at remaining health for points)
        actualDamage = Math.min(damage, targetBlock.currentHealth);
        wasKilled = targetBlock.currentHealth <= damage;
      }
    }
    
    // Apply the update to the ref synchronously (for rapid fire accuracy)
    // Track if THIS specific shwarm just died (was active, now all dead)
    let justKilledTier: number | null = null;
    
    const updatedShwarms = shwarmsRef.current.map(shwarm => {
      if (shwarm.id !== shwarmId) return shwarm;

      const updatedBlocks = shwarm.blocks.map(block => {
        if (block.id !== blockId || !block.isAlive) return block;
        
        const newHealth = Math.max(0, block.currentHealth - damage);
        const isAlive = newHealth > 0;
        
        // Calculate visual scale based on health in 10% increments
        const healthPercent = newHealth / block.maxHealth;
        const scale = Math.max(0.1, Math.floor(healthPercent * 10) / 10);

        return {
          ...block,
          currentHealth: newHealth,
          isAlive,
          scale,
        };
      });

      // Check if all blocks dead
      const allDead = updatedBlocks.every(b => !b.isAlive);
      
      // Only trigger callback if THIS shwarm was active and just became fully dead
      if (allDead && shwarm.isActive) {
        justKilledTier = shwarm.definition.tier;
      }
      
      return {
        ...shwarm,
        blocks: updatedBlocks,
        isActive: !allDead,
      };
    });
    
    // Update ref synchronously, then state
    shwarmsRef.current = updatedShwarms;
    setShwarms(updatedShwarms);
    
    // Trigger callback AFTER state update, only once for the killed shwarm
    if (justKilledTier !== null) {
      setTimeout(() => onGroupKilled?.(justKilledTier!), 0);
    }

    return { wasKilled, actualDamage };
  }, [onGroupKilled]);

  /**
   * Get definition by tier (0 = tier 10)
   */
  const getDefinitionByTier = useCallback((tier: number): ShwarmDefinition | null => {
    if (!definitions || definitions.length === 0) return null;
    const actualTier = tier === 0 ? 10 : tier;
    return definitions.find(d => d.tier === actualTier) ?? null;
  }, [definitions]);

  /**
   * Spawn a shwarm by tier (for universal spawn command)
   */
  const spawnShwarmByTier = useCallback((tier: number): ShwarmInstance | null => {
    const definition = getDefinitionByTier(tier);
    if (!definition) {
      console.warn(`[Shwarm] No definition found for tier ${tier}`);
      return null;
    }
    return spawnShwarm(definition);
  }, [getDefinitionByTier, spawnShwarm]);

  // Cleanup dead shwarms - no delay, remove immediately
  useEffect(() => {
    const interval = setInterval(() => {
      setShwarms(prev => {
        const dead = prev.filter(s => !s.isActive);
        const active = prev.filter(s => s.isActive);
        if (dead.length > 0) {
          console.log(`[Shwarm] Cleaned up ${dead.length} dead shwarms`);
        }
        return active;
      });
    }, 500); // Faster cleanup - 500ms instead of 2s

    return () => clearInterval(interval);
  }, []);

  return {
    shwarms,
    shwarmsRef,
    spawnShwarm,
    spawnShwarmByTier,
    removeShwarm,
    damageBlock,
    getDefinitionByTier,
  };
}
