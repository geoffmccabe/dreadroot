import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShombieDefinition, ShombieInstance } from '../types';
import {
  CHUNK_SIZE,
  MAX_SHOMBIES_PER_CHUNK,
  MAX_TOTAL_SHOMBIES,
  SPAWN_CHECK_INTERVAL_MS,
  SHOMBIE_SPAWN_BOUNDS,
  SHOMBIE_SCALE_VARIATION,
  SHOMBIE_GROUP_SPREAD_RADIUS,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';

interface UseShombieSystemOptions {
  definitions: ShombieDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  /** User roles for admin hotkey access */
  userRoles: string[];
  onShombieKilled?: (tier: number) => void;
}

// Pre-allocated vectors
const _spawnPos = new THREE.Vector3();

// Audio settings
const MOAN_SOUND_URL = '/shombie_moan_1.mp3';
const MOAN_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
const MOAN_CHANCE = 0.1; // 10% chance per zombie per check
const MOAN_VOLUME = 0.5; // 50% volume

// Preload shombie sounds
preloadSpatialSounds([MOAN_SOUND_URL]);

/**
 * Hook to manage active shombies with chunk-based spawning
 * Ctrl+Z toggles natural spawning on/off (admin/superadmin only)
 */
export function useShombieSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
  onShombieKilled,
}: UseShombieSystemOptions) {
  const [shombies, setShombies] = useState<ShombieInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(false);
  const shombiesRef = useRef<ShombieInstance[]>([]);
  
  // Keep ref in sync
  useEffect(() => {
    shombiesRef.current = shombies;
  }, [shombies]);

  // Check if user is admin
  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');

  /**
   * Get definition by tier
   */
  const getDefinitionByTier = useCallback((tier: number): ShombieDefinition | null => {
    // 0 means tier 10
    const actualTier = tier === 0 ? 10 : tier;
    return definitions?.find(d => d.tier === actualTier) ?? null;
  }, [definitions]);

  /**
   * Ambient moan sounds - 10% chance per zombie every 5 seconds
   */
  useEffect(() => {
    if (!isEnabled) return;
    // Play moans even when natural spawning is disabled (for manually spawned shombies)

    const moanCheck = () => {
      const camera = cameraRef.current;
      if (!camera) return;
      if (shombiesRef.current.length === 0) return;

      for (const shombie of shombiesRef.current) {
        if (!shombie.isActive) continue;
        
        // 10% chance per zombie
        if (Math.random() < MOAN_CHANCE) {
          // Calculate distance to camera
          const dx = shombie.position.x - camera.position.x;
          const dy = shombie.position.y - camera.position.y;
          const dz = shombie.position.z - camera.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          // Play spatial audio with distance-based volume
          playSpatialSound(MOAN_SOUND_URL, distance, { baseVolume: MOAN_VOLUME });
        }
      }
    };

    const interval = setInterval(moanCheck, MOAN_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled, cameraRef]);

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
   * Spawn a shombie at a specific world position with scale variation and emergence
   */
  const spawnShombieAt = useCallback((
    definition: ShombieDefinition,
    worldX: number,
    worldZ: number,
  ): ShombieInstance | null => {
    if (shombiesRef.current.length >= MAX_TOTAL_SHOMBIES) {
      console.warn('[Shombie] Max total shombies reached');
      return null;
    }

    // Clamp to bounds
    const x = Math.max(SHOMBIE_SPAWN_BOUNDS.minX, Math.min(SHOMBIE_SPAWN_BOUNDS.maxX, worldX));
    const z = Math.max(SHOMBIE_SPAWN_BOUNDS.minZ, Math.min(SHOMBIE_SPAWN_BOUNDS.maxZ, worldZ));

    const id = `shombie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Random scale variation ±20%
    const scale = 1 + (Math.random() * 2 - 1) * SHOMBIE_SCALE_VARIATION;
    
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);
    
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
      scale,
      emergenceProgress: 0, // Start underground
    };

    shombiesRef.current = [...shombiesRef.current, instance];
    setShombies(shombiesRef.current);
    
    console.log(`[Shombie] Spawned tier ${definition.tier} at (${x.toFixed(1)}, ${z.toFixed(1)}) scale=${scale.toFixed(2)}`);
    return instance;
  }, []);

  /**
   * Spawn a shombie in a chunk (for ambient spawning)
   */
  const spawnShombie = useCallback((
    definition: ShombieDefinition,
    chunkX: number,
    chunkZ: number
  ): ShombieInstance | null => {
    // Random position within chunk
    const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    
    return spawnShombieAt(definition, worldX, worldZ);
  }, [spawnShombieAt]);

  /**
   * Spawn a group of shombies around player position (for admin spawn commands)
   */
  const spawnShombieGroup = useCallback((tier: number, count: number) => {
    const definition = getDefinitionByTier(tier);
    if (!definition) {
      console.warn(`[Shombie] No definition for tier ${tier}`);
      return;
    }

    const camera = cameraRef.current;
    if (!camera) {
      console.warn('[Shombie] Cannot spawn group - no camera');
      return;
    }

    // Spawn in front of player, spread in a semicircle
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const baseX = camera.position.x + forward.x * 8; // 8 blocks in front
    const baseZ = camera.position.z + forward.z * 8;

    for (let i = 0; i < count; i++) {
      // Spread around the base position
      const angle = (Math.random() - 0.5) * Math.PI; // Semicircle in front
      const radius = Math.random() * SHOMBIE_GROUP_SPREAD_RADIUS;
      
      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;
      
      spawnShombieAt(definition, baseX + offsetX, baseZ + offsetZ);
    }
    
    console.log(`[Shombie] Spawned group of ${count} tier ${tier} shombies`);
  }, [cameraRef, getDefinitionByTier, spawnShombieAt]);

  /**
   * Ctrl+Z toggle for natural spawning (admin only)
   */
  useEffect(() => {
    if (!isEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input fields
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // Ctrl+Z for zombie toggle
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        
        if (!isAdmin) {
          console.log('[Shombie] Ctrl+Z denied - admin only');
          return;
        }

        setSpawningEnabled(prev => {
          const newState = !prev;
          console.log(`[Shombie] Natural spawning ${newState ? 'ENABLED' : 'DISABLED'}`);
          return newState;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEnabled, isAdmin]);

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
   * Chunk-based natural spawn loop
   * Spawns from all chunks within range, rate halves per chunk distance
   */
  useEffect(() => {
    if (!isEnabled || !spawningEnabled) {
      return;
    }
    
    if (!definitions || definitions.length === 0) {
      console.log('[Shombie] Natural spawning enabled but no definitions loaded');
      return;
    }

    const tier1Def = definitions.find(d => d.tier === 1);
    if (!tier1Def) {
      console.log('[Shombie] No tier 1 definition found');
      return;
    }

    console.log(`[Shombie] Natural spawning loop started, tier1 spawn_chance=${tier1Def.spawn_chance_per_minute}/min`);

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
  }, [isEnabled, spawningEnabled, definitions, getPlayerChunk, countInChunk, spawnShombie]);

  return {
    shombies,
    shombiesRef,
    spawningEnabled,
    spawnShombie,
    spawnShombieGroup,
    getDefinitionByTier,
    damageShombie,
    clearAllShombies,
  };
}
