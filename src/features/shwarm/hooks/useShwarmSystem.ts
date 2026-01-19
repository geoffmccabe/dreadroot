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
  onGroupKilled?: () => void; // Called when all blocks in a shwarm group are killed
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

  // Keyboard sequence state
  const sequenceRef = useRef<{
    step: number; // 0 = waiting for !, 1 = waiting for type, 2 = waiting for tier
    startTime: number;
    type: number | null;
  }>({ step: 0, startTime: 0, type: null });

  const SEQUENCE_TIMEOUT_MS = 3000;

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

    setShwarms(prev => [...prev, instance]);
    console.log(`[Shwarm] Spawned tier ${definition.tier} shwarm with ${actualBlockCount} blocks at`, spawnPos);

    return instance;
  }, [calculateSpawnPosition]);

  /**
   * Remove a shwarm instance
   */
  const removeShwarm = useCallback((shwarmId: string) => {
    setShwarms(prev => prev.filter(s => s.id !== shwarmId));
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
    
    // Now apply the state update
    setShwarms(prev => prev.map(shwarm => {
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
      
      // If this shwarm just became fully dead, trigger callback
      if (allDead && shwarm.isActive) {
        setTimeout(() => onGroupKilled?.(), 0);
      }
      
      return {
        ...shwarm,
        blocks: updatedBlocks,
        isActive: !allDead,
      };
    }));

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

  // Keyboard sequence listener
  useEffect(() => {
    if (!isEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input fields
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const now = Date.now();
      const seq = sequenceRef.current;

      // Check for timeout
      if (seq.step > 0 && now - seq.startTime > SEQUENCE_TIMEOUT_MS) {
        seq.step = 0;
        seq.type = null;
      }

      // Step 0: Wait for "!" (Shift+1)
      if (seq.step === 0) {
        if (e.key === '!' || (e.shiftKey && e.key === '1')) {
          seq.step = 1;
          seq.startTime = now;
          console.log('[Shwarm] Spawn sequence started - press 1 for enemy type');
          return;
        }
      }

      // Step 1: Wait for enemy type (1 = shwarm)
      if (seq.step === 1) {
        if (e.key === '1' && !e.shiftKey) {
          seq.step = 2;
          seq.type = 1; // shwarm
          console.log('[Shwarm] Enemy type selected: shwarm - press 1-0 for tier');
          return;
        }
        // Invalid key resets
        seq.step = 0;
        seq.type = null;
        return;
      }

      // Step 2: Wait for tier (1-9, 0=10)
      if (seq.step === 2) {
        const tier = parseInt(e.key, 10);
        if (!isNaN(tier) && tier >= 0 && tier <= 9 && !e.shiftKey) {
          // Spawn shwarm!
          const definition = getDefinitionByTier(tier);
          if (definition) {
            spawnShwarm(definition);
          } else {
            console.warn(`[Shwarm] No definition found for tier ${tier === 0 ? 10 : tier}`);
          }
          
          // Reset sequence
          seq.step = 0;
          seq.type = null;
          return;
        }
        // Invalid key resets
        seq.step = 0;
        seq.type = null;
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEnabled, getDefinitionByTier, spawnShwarm]);

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
    removeShwarm,
    damageBlock,
  };
}
