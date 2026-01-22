import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShombieDefinition, ShombieInstance, HeadMovementType } from '../types';
import { generatePartTwitches } from '../types';
import {
  CHUNK_SIZE,
  MAX_SHOMBIES_PER_CHUNK,
  MAX_TOTAL_SHOMBIES,
  SPAWN_CHECK_INTERVAL_MS,
  SHOMBIE_SPAWN_BOUNDS,
  SHOMBIE_SCALE_VARIATION,
  SHOMBIE_GROUP_SPREAD_RADIUS,
  SHOMBIE_CHASE_SPEED_MULTIPLIER,
  KNOCKBACK_DECAY_RATE,
  SHOMBIE_GRAVITY,
  SHOMBIE_ATTACK_RANGE,
  SHOMBIE_ATTACK_COOLDOWN_MS,
  KNOCKDOWN_SLIDE_DISTANCE,
  KNOCKDOWN_DURATION_MS,
  SHOMBIE_COLLISION_RADIUS,
  SHOMBIE_SEPARATION_FORCE,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';

// Head movement type randomizer - 1/3 each
function randomHeadMovementType(): HeadMovementType {
  const rand = Math.random();
  if (rand < 0.333) return 'slide';
  if (rand < 0.666) return 'bob';
  return 'circle';
}

interface UseShombieSystemOptions {
  definitions: ShombieDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  /** User roles for admin hotkey access */
  userRoles: string[];
  onShombieKilled?: (tier: number) => void;
  /** Callback when shombie attacks player */
  onPlayerHit?: (damage: number, knockbackForce: number, direction: THREE.Vector3) => void;
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
  onPlayerHit,
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
      partTwitches: generatePartTwitches(),
      isChasing: false,
      headMovementType: randomHeadMovementType(), // Random 1/3 slide, 1/3 bob, 1/3 circle
      isKnockedDown: false,
      knockdownProgress: 0,
      knockdownStartTime: 0,
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
   * @param isHeadshot - If true, triggers knockdown animation instead of knockback
   * @param bulletDirection - Direction the bullet was traveling (for knockdown slide)
   */
  const damageShombie = useCallback((
    shombieId: string,
    damage: number,
    knockbackDir?: THREE.Vector3,
    isHeadshot: boolean = false,
    bulletDirection?: THREE.Vector3
  ): boolean => {
    const shombie = shombiesRef.current.find(s => s.id === shombieId);
    if (!shombie || !shombie.isActive) return false;

    shombie.currentHealth -= damage;
    shombie.lastDamagedAt = Date.now();

    if (isHeadshot && bulletDirection) {
      // Headshot: knockdown and slide in bullet direction
      shombie.isKnockedDown = true;
      shombie.knockdownDirection = bulletDirection.clone().normalize();
      shombie.knockdownDirection.y = 0; // Horizontal only
      shombie.knockdownProgress = 0;
      shombie.knockdownStartTime = Date.now();
      // Clear velocity when knocked down
      shombie.velocity.set(0, 0, 0);
    } else if (knockbackDir) {
      // Body shot: apply knockback
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
   * Movement update - pathfind to player, apply physics, and avoid other shombies
   * Called from frame loop
   */
  const updateMovement = useCallback((deltaTime: number) => {
    const camera = cameraRef.current;
    if (!camera) return;
    
    let needsUpdate = false;
    const allShombies = shombiesRef.current;
    
    for (const shombie of allShombies) {
      if (!shombie.isActive) continue;
      
      // Don't move until fully emerged
      if (shombie.emergenceProgress < 1) continue;
      
      // Handle knockdown animation
      if (shombie.isKnockedDown) {
        const now = Date.now();
        const elapsed = now - shombie.knockdownStartTime;
        const progress = Math.min(1, elapsed / KNOCKDOWN_DURATION_MS);
        shombie.knockdownProgress = progress;
        
        // Slide in knockdown direction (decelerate over time)
        if (shombie.knockdownDirection && progress < 1) {
          const slideSpeed = KNOCKDOWN_SLIDE_DISTANCE * (1 - progress) * (deltaTime / (KNOCKDOWN_DURATION_MS / 1000));
          shombie.position.x += shombie.knockdownDirection.x * slideSpeed * 3; // 3x speed initially
          shombie.position.z += shombie.knockdownDirection.z * slideSpeed * 3;
        }
        
        // End knockdown when complete
        if (progress >= 1) {
          shombie.isKnockedDown = false;
          shombie.knockdownProgress = 0;
        }
        
        needsUpdate = true;
        continue; // Skip normal movement when knocked down
      }
      
      // Calculate direction to player
      const dx = camera.position.x - shombie.position.x;
      const dz = camera.position.z - shombie.position.z;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);
      
      // Shombie-to-shombie collision avoidance
      let separationX = 0;
      let separationZ = 0;
      for (const other of allShombies) {
        if (other.id === shombie.id || !other.isActive) continue;
        
        const ox = shombie.position.x - other.position.x;
        const oz = shombie.position.z - other.position.z;
        const distToOther = Math.sqrt(ox * ox + oz * oz);
        
        if (distToOther < SHOMBIE_COLLISION_RADIUS * 2 && distToOther > 0.01) {
          // Push apart
          const overlap = SHOMBIE_COLLISION_RADIUS * 2 - distToOther;
          const pushForce = (overlap / distToOther) * SHOMBIE_SEPARATION_FORCE;
          separationX += (ox / distToOther) * pushForce * deltaTime;
          separationZ += (oz / distToOther) * pushForce * deltaTime;
        }
      }
      
      // Apply separation force
      shombie.position.x += separationX;
      shombie.position.z += separationZ;
      
      // Chase the player
      if (dist > SHOMBIE_ATTACK_RANGE) {
        shombie.isChasing = true;
        
        // Normalize direction
        const invDist = 1 / dist;
        const dirX = dx * invDist;
        const dirZ = dz * invDist;
        
        // Move toward player at definition speed
        const speed = shombie.definition.speed * SHOMBIE_CHASE_SPEED_MULTIPLIER;
        shombie.velocity.x = dirX * speed;
        shombie.velocity.z = dirZ * speed;
        
        // Face the player
        shombie.rotation = Math.atan2(dirX, dirZ);
      } else {
        shombie.isChasing = false;
        
        // In attack range - stop moving horizontally
        shombie.velocity.x *= 0.8;
        shombie.velocity.z *= 0.8;
        
        // Attack check
        const now = Date.now();
        if (now - shombie.lastAttackAt > SHOMBIE_ATTACK_COOLDOWN_MS) {
          shombie.lastAttackAt = now;
          
          // Attack player!
          if (onPlayerHit) {
            const damage = shombie.definition.damage_per_hit;
            // Knockback direction from shombie toward player (normalized)
            const knockbackDir = new THREE.Vector3(
              camera.position.x - shombie.position.x,
              0,
              camera.position.z - shombie.position.z
            ).normalize();
            
            // Knockback force based on definition (default 3)
            const knockbackForce = 3;
            onPlayerHit(damage, knockbackForce, knockbackDir);
            
            console.log(`[Shombie] Attack! Dealt ${damage} damage`);
          }
        }
      }
      
      // Apply knockback decay
      const decayFactor = Math.exp(-KNOCKBACK_DECAY_RATE * deltaTime);
      // Don't decay chase velocity, only knockback component would be decayed separately
      
      // Apply gravity
      if (shombie.position.y > 0) {
        shombie.velocity.y -= SHOMBIE_GRAVITY * deltaTime;
      } else {
        shombie.velocity.y = 0;
        shombie.position.y = 0;
      }
      
      // Apply velocity to position
      shombie.position.x += shombie.velocity.x * deltaTime;
      shombie.position.y += shombie.velocity.y * deltaTime;
      shombie.position.z += shombie.velocity.z * deltaTime;
      
      // Clamp to ground
      if (shombie.position.y < 0) {
        shombie.position.y = 0;
        shombie.velocity.y = 0;
      }
      
      needsUpdate = true;
    }
    
    // Only trigger React update if needed (not every frame - refs handle visual updates)
  }, [cameraRef, onPlayerHit]);

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
    updateMovement,
  };
}
