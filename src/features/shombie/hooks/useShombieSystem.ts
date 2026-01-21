import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShombieDefinition, ShombieInstance } from '../types';
import {
  CHUNK_SIZE,
  MAX_SHOMBIES_PER_CHUNK,
  MAX_TOTAL_SHOMBIES,
  SPAWN_CHECK_INTERVAL_MS,
  SHOMBIE_SPAWN_BOUNDS,
} from '../constants';

interface UseShombieSystemOptions {
  definitions: ShombieDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  onShombieKilled?: (tier: number) => void;
}

// Pre-allocated vectors
const _spawnPos = new THREE.Vector3();

/**
 * Hook to manage active shombies with chunk-based spawning
 * Spawns 1/min in nearby chunks, halving rate per chunk distance
 */
export function useShombieSystem({
  definitions,
  cameraRef,
  isEnabled,
  onShombieKilled,
}: UseShombieSystemOptions) {
  const [shombies, setShombies] = useState<ShombieInstance[]>([]);
  const shombiesRef = useRef<ShombieInstance[]>([]);
  
  // Keep ref in sync
  useEffect(() => {
    shombiesRef.current = shombies;
  }, [shombies]);

  /**
   * Get player's current chunk
   */
  const getPlayerChunk = useCallback((): { x: number; z: number } | null => {
    const camera = cameraRef.current;
    if (!camera) return null;
    return {
      x: Math.floor(camera.position.x / CHUNK_SIZE),
      z: Math.floor(camera.position.z / CHUNK_SIZE),
    };
  }, [cameraRef]);

  /**
   * Count shombies in a specific chunk
   */
  const countInChunk = useCallback((chunkX: number, chunkZ: number): number => {
    return shombiesRef.current.filter(s => 
      s.isActive && s.spawnChunkX === chunkX && s.spawnChunkZ === chunkZ
    ).length;
  }, []);

  /**
   * Spawn a shombie at a specific position
   */
  const spawnShombie = useCallback((
    definition: ShombieDefinition,
    chunkX: number,
    chunkZ: number
  ): ShombieInstance | null => {
    if (shombiesRef.current.length >= MAX_TOTAL_SHOMBIES) {
      return null;
    }

    // Random position within chunk
    const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    
    // Clamp to bounds
    const x = Math.max(SHOMBIE_SPAWN_BOUNDS.minX, Math.min(SHOMBIE_SPAWN_BOUNDS.maxX, worldX));
    const z = Math.max(SHOMBIE_SPAWN_BOUNDS.minZ, Math.min(SHOMBIE_SPAWN_BOUNDS.maxZ, worldZ));

    const id = `shombie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const instance: ShombieInstance = {
      id,
      definition,
      position: new THREE.Vector3(x, 0, z),
      rotation: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      spawnedAt: Date.now(),
      velocity: new THREE.Vector3(0, 0, 0),
      animationPhase: Math.random() * Math.PI * 2,
      lastAttackAt: 0,
      lastDamagedAt: 0,
      spawnChunkX: chunkX,
      spawnChunkZ: chunkZ,
    };

    shombiesRef.current = [...shombiesRef.current, instance];
    setShombies(shombiesRef.current);
    
    console.log(`[Shombie] Spawned tier ${definition.tier} at chunk (${chunkX}, ${chunkZ})`);
    return instance;
  }, []);

  /**
   * Damage a shombie
   */
  const damageShombie = useCallback((
    shombieId: string,
    damage: number,
    knockbackDir?: THREE.Vector3
  ): boolean => {
    const shombie = shombiesRef.current.find(s => s.id === shombieId);
    if (!shombie || !shombie.isActive) return false;

    shombie.currentHealth -= damage;
    shombie.lastDamagedAt = Date.now();

    // Apply knockback
    if (knockbackDir) {
      const knockbackForce = shombie.definition.knockback_received;
      shombie.velocity.x += knockbackDir.x * knockbackForce;
      shombie.velocity.z += knockbackDir.z * knockbackForce;
      shombie.velocity.y += 2; // Small upward bounce
    }

    if (shombie.currentHealth <= 0) {
      shombie.isActive = false;
      onShombieKilled?.(shombie.definition.tier);
      
      // Remove from list
      shombiesRef.current = shombiesRef.current.filter(s => s.id !== shombieId);
      setShombies(shombiesRef.current);
      
      console.log(`[Shombie] Killed ${shombieId}`);
      return true;
    }

    // Update state
    setShombies([...shombiesRef.current]);
    return false;
  }, [onShombieKilled]);

  /**
   * Clear all shombies (e.g., on respawn)
   */
  const clearAllShombies = useCallback(() => {
    shombiesRef.current = [];
    setShombies([]);
  }, []);

  /**
   * Chunk-based spawn loop
   * Spawns from all chunks within range, rate halves per chunk distance
   */
  useEffect(() => {
    if (!isEnabled || !definitions || definitions.length === 0) return;

    const tier1Def = definitions.find(d => d.tier === 1);
    if (!tier1Def) return;

    const spawnCheck = () => {
      const playerChunk = getPlayerChunk();
      if (!playerChunk) return;

      // Check chunks within 5 chunk radius
      const maxChunkDist = 5;
      
      for (let dx = -maxChunkDist; dx <= maxChunkDist; dx++) {
        for (let dz = -maxChunkDist; dz <= maxChunkDist; dz++) {
          const chunkX = playerChunk.x + dx;
          const chunkZ = playerChunk.z + dz;
          const chunkDist = Math.max(Math.abs(dx), Math.abs(dz));
          
          // Skip player's immediate chunk (too close)
          if (chunkDist === 0) continue;
          
          // Check chunk capacity
          if (countInChunk(chunkX, chunkZ) >= MAX_SHOMBIES_PER_CHUNK) continue;
          
          // Calculate spawn probability
          // Base: spawn_chance_per_minute, halved per chunk distance
          // Convert to probability for our check interval
          const baseChancePerMinute = tier1Def.spawn_chance_per_minute;
          const distanceMultiplier = Math.pow(0.5, chunkDist - 1); // 1 at dist 1, 0.5 at dist 2, etc.
          const chancePerMinute = baseChancePerMinute * distanceMultiplier;
          const chancePerCheck = chancePerMinute * (SPAWN_CHECK_INTERVAL_MS / 60000);
          
          if (Math.random() < chancePerCheck) {
            spawnShombie(tier1Def, chunkX, chunkZ);
          }
        }
      }
    };

    // Initial spawn after delay
    const initialTimer = setTimeout(spawnCheck, 2000);
    const interval = setInterval(spawnCheck, SPAWN_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isEnabled, definitions, getPlayerChunk, countInChunk, spawnShombie]);

  return {
    shombies,
    shombiesRef,
    spawnShombie,
    damageShombie,
    clearAllShombies,
  };
}
