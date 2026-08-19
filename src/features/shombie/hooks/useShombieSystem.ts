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
  KNOCKDOWN_SLIDE_DISTANCE_PER_LEVEL,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { EnemyManager } from '@/features/enemies/ai/EnemyManager';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import { seededFrom } from '@/lib/seededRandom';
import { SHOMBIE_HITBOX_RADIUS, SHOMBIE_HITBOX_HEIGHT, MAX_KNOCKBACK_SPEED, TUMBLE_RATE_MIN, TUMBLE_RATE_MAX } from '../constants';

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
  /** Player's current level (for knockback distance calculation) */
  playerLevel?: number;
  onShombieKilled?: (tier: number, x: number, y: number, z: number) => void;
}

// Pre-allocated vectors
const _spawnPos = new THREE.Vector3();

// Audio settings
const MOAN_SOUND_URL = '/shombie_moan_1.mp3';
const HURT_SOUND_URL = '/shombie_hurt.mp3';
const HURT_SOUND_VOLUME = 0.7;
const MAX_CONCURRENT_HURT_SOUNDS = 6;
const MOAN_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
const MOAN_CHANCE = 0.1; // 10% chance per zombie per check
const MOAN_VOLUME = 0.5; // 50% volume

// Death sound: the shombie's own moan pitched down to ~0 — an electronic
// zombie powering down. Capped so a horde wiped by one grenade plays a few
// overlapping power-downs simultaneously, not 100 in sequence.
const DEATH_SOUND_VOLUME = 1.0; // loud onset so the power-down is clearly heard
const DEATH_SOUND_PITCH_DOWN_MS = 1300;
const MAX_CONCURRENT_DEATH_SOUNDS = 6;

// Preload shombie sounds
preloadSpatialSounds([MOAN_SOUND_URL, HURT_SOUND_URL]);

/**
 * Hook to manage active shombies with chunk-based spawning
 * Ctrl+Z toggles natural spawning on/off (admin/superadmin only)
 */
export function useShombieSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
  playerLevel = 1,
  onShombieKilled,
}: UseShombieSystemOptions) {
  const [shombies, setShombies] = useState<ShombieInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(false);
  const shombiesRef = useRef<ShombieInstance[]>([]);

  // Keep ref in sync
  useEffect(() => {
    shombiesRef.current = shombies;
  }, [shombies]);

  // Shombie separation now reads the shared EnemySpatialIndex (built each AI
  // tick by EnemyManager), so no per-frame shombie-only hash rebuild is needed.

  // Batched dead-shombie sweep. Deaths only mark isActive=false (no per-kill
  // re-render); this compacts the array + syncs React state once per second,
  // so a horde wiped by one grenade costs ONE re-render, not 100.
  const deadPendingRef = useRef(false);
  // Concurrent power-down death sounds in flight (capped).
  const deathSoundCountRef = useRef(0);
  const hurtSoundCountRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      // Always compact: instant deaths set isActive=false here, but ragdoll
      // corpses despawn later in applyResult (no deadPending signal), so we
      // can't gate on deadPendingRef. Cheap O(n) filter once per second.
      deadPendingRef.current = false;
      const before = shombiesRef.current.length;
      shombiesRef.current = shombiesRef.current.filter(s => s.isActive);
      if (shombiesRef.current.length !== before) setShombies(shombiesRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
      if (shombiesRef.current.length === 0) return;
      const p = getLocalPlayerSnapshot();

      for (const shombie of shombiesRef.current) {
        if (!shombie.isActive) continue;
        if (Math.random() < MOAN_CHANCE) {
          const dx = shombie.position.x - p.x;
          const dy = shombie.position.y - p.y;
          const dz = shombie.position.z - p.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          playSpatialSound(MOAN_SOUND_URL, distance, { baseVolume: MOAN_VOLUME });
        }
      }
    };

    const interval = setInterval(moanCheck, MOAN_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled]);

  /**
   * Get player's current chunk
   */
  const getPlayerChunk = useCallback((): { x: number; z: number } | null => {
    const p = getLocalPlayerSnapshot();
    return {
      x: Math.floor(p.x / CHUNK_SIZE),
      z: Math.floor(p.z / CHUNK_SIZE),
    };
  }, []);

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
    /** Stable id from the deterministic planner. When supplied, every client
     *  names this creature the same thing — which is what makes a shared kill
     *  possible — and any gameplay-relevant randomness is derived from it so
     *  the creature is IDENTICAL everywhere. Omitted = legacy random spawn. */
    presetId?: string,
  ): ShombieInstance | null => {
    if (shombiesRef.current.length >= MAX_TOTAL_SHOMBIES) {
      console.warn('[Shombie] Max total shombies reached');
      return null;
    }

    // Clamp to bounds
    const x = Math.max(SHOMBIE_SPAWN_BOUNDS.minX, Math.min(SHOMBIE_SPAWN_BOUNDS.maxX, worldX));
    const z = Math.max(SHOMBIE_SPAWN_BOUNDS.minZ, Math.min(SHOMBIE_SPAWN_BOUNDS.maxZ, worldZ));

    const id = presetId ?? `shombie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Scale variation ±20%. This is NOT purely cosmetic — it feeds the hitbox
    // height via the adapter — so under a deterministic id it must be derived
    // from that id, or two players would shoot at differently-sized creatures.
    // Purely visual randomness (twitches, head movement, animation phase) is
    // deliberately left local: it costs nothing to disagree on.
    const scale = presetId !== undefined
      ? 1 + (seededFrom(presetId, 'scale').next() * 2 - 1) * SHOMBIE_SCALE_VARIATION
      : 1 + (Math.random() * 2 - 1) * SHOMBIE_SCALE_VARIATION;
    
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
      bodyFires: [], // No fires initially
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
    // Random base position within chunk.
    const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;

    // Spawn a cluster of 1-5 near each other for a horde feel (each within
    // SHOMBIE_GROUP_SPREAD_RADIUS of the base). spawnShombieAt enforces the
    // total cap, so excess in a full world is harmlessly skipped.
    const clusterSize = 1 + Math.floor(Math.random() * 5);
    let first: ShombieInstance | null = null;
    for (let i = 0; i < clusterSize; i++) {
      const ox = (Math.random() - 0.5) * 2 * SHOMBIE_GROUP_SPREAD_RADIUS;
      const oz = (Math.random() - 0.5) * 2 * SHOMBIE_GROUP_SPREAD_RADIUS;
      const s = spawnShombieAt(definition, worldX + ox, worldZ + oz);
      if (s && !first) first = s;
    }
    return first;
  }, [spawnShombieAt]);

  /**
   * Spawn a group of shombies around player position (for admin spawn commands)
   * If tier is 0, spawns 10 shombies of tier 10
   */
  const spawnShombieGroup = useCallback((tier: number, count: number) => {
    // Tier 0 means tier 10 and always spawns 10
    const spawnCount = tier === 0 ? 10 : count;

    const definition = getDefinitionByTier(tier);
    if (!definition) {
      console.warn(`[Shombie] No definition for tier ${tier}`);
      return;
    }

    // Spawn 8 blocks in front of the player, spread in a semicircle.
    // Forward derived from snapshot yaw — at yaw=0 the player looks
    // down -Z, so forward = (-sin yaw, 0, -cos yaw).
    const p = getLocalPlayerSnapshot();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const baseX = p.x + fx * 8;
    const baseZ = p.z + fz * 8;

    for (let i = 0; i < spawnCount; i++) {
      // Spread around the base position
      const angle = (Math.random() - 0.5) * Math.PI; // Semicircle in front
      const radius = Math.random() * SHOMBIE_GROUP_SPREAD_RADIUS;

      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;

      spawnShombieAt(definition, baseX + offsetX, baseZ + offsetZ);
    }

    console.log(`[Shombie] Spawned group of ${spawnCount} tier ${definition.tier} shombies`);
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
    bulletDirection?: THREE.Vector3,
    /** Strength of the knockback impulse. Bullets default to ~1 m/s;
     *  grenade blasts pass a much larger value (post-falloff). The
     *  knockbackDir Y component lets blasts launch shombies upward. */
    kbStrength: number = 1.0,
    /** Inter-enemy melee kill → ragdoll-launch the corpse (the shombie's
     *  "explosion-like" death), at reduced momentum vs a grenade. */
    isMeleeKill: boolean = false,
  ): boolean => {
    const shombie = shombiesRef.current.find(s => s.id === shombieId);
    // Corpses are already-dead ragdolls — ignore further damage (e.g. lingering
    // burn ticks) so they don't re-trigger death / double-count the kill.
    if (!shombie || !shombie.isActive || shombie.isCorpse) return false;

    shombie.currentHealth -= damage;
    shombie.lastDamagedAt = Date.now();

    if (isHeadshot && bulletDirection) {
      // Headshot: knockdown and slide in bullet direction
      shombie.isKnockedDown = true;
      shombie.knockdownDirection = bulletDirection.clone().normalize();
      shombie.knockdownDirection.y = 0; // Horizontal only
      shombie.knockdownProgress = 0;
      shombie.knockdownStartTime = Date.now();
      // Store slide distance: 50% of (1 block per player level)
      shombie.knockdownSlideDistance = KNOCKDOWN_SLIDE_DISTANCE_PER_LEVEL * playerLevel * 0.5;
      // Clear velocity when knocked down
      shombie.velocity.set(0, 0, 0);
    } else if (knockbackDir) {
      // Apply the impulse on all three axes. Grenade source passes a
      // unit-length knockbackDir with a 0–45° upward tilt baked in;
      // bullets pass horizontal-only at kbStrength=1.
      shombie.velocity.x = knockbackDir.x * kbStrength;
      shombie.velocity.z = knockbackDir.z * kbStrength;
      if (knockbackDir.y > 0) {
        shombie.velocity.y = knockbackDir.y * kbStrength;
      }
      // Cap total launch speed so blasts arc them a sane distance.
      const sp2 = shombie.velocity.x * shombie.velocity.x
        + shombie.velocity.y * shombie.velocity.y
        + shombie.velocity.z * shombie.velocity.z;
      if (sp2 > MAX_KNOCKBACK_SPEED * MAX_KNOCKBACK_SPEED) {
        const sc = MAX_KNOCKBACK_SPEED / Math.sqrt(sp2);
        shombie.velocity.x *= sc;
        shombie.velocity.y *= sc;
        shombie.velocity.z *= sc;
      }
      shombie.stunUntil = Date.now() + 1000;

      // Blast (upward launch) → tumble: random 3D spin in the air, then land
      // rotated, slide, wait, and rise upright (handled in applyResult +
      // renderer). Bullets (y=0) just get the small knockback above.
      if (knockbackDir.y > 0) {
        const ax = Math.random() * 2 - 1;
        const ay = Math.random() * 2 - 1;
        const az = Math.random() * 2 - 1;
        const inv = 1 / (Math.hypot(ax, ay, az) || 1);
        // A blast supersedes any in-progress headshot knockdown (which would
        // otherwise early-return in applyResult and block the launch + tumble).
        shombie.isKnockedDown = false;
        shombie.isTumbling = true;
        shombie.tumbleAxisX = ax * inv;
        shombie.tumbleAxisY = ay * inv;
        shombie.tumbleAxisZ = az * inv;
        shombie.tumbleRate = TUMBLE_RATE_MIN + Math.random() * (TUMBLE_RATE_MAX - TUMBLE_RATE_MIN);
        shombie.tumbleLaunchAt = Date.now();
        shombie.tumbleLandedAt = 0;
      }
    }

    // Non-fatal hit → "hurt" sound (in sync with the damage + knockback above).
    // Throttled like the death sound so a horde getting peppered isn't 100 at
    // once. The fatal hit plays the death sound instead (below).
    if (shombie.currentHealth > 0) {
      if (hurtSoundCountRef.current < MAX_CONCURRENT_HURT_SOUNDS) {
        const p = getLocalPlayerSnapshot();
        const hdx = shombie.position.x - p.x;
        const hdy = shombie.position.y - p.y;
        const hdz = shombie.position.z - p.z;
        const hdist = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
        hurtSoundCountRef.current++;
        playSpatialSound(HURT_SOUND_URL, hdist, { baseVolume: HURT_SOUND_VOLUME });
        setTimeout(() => { hurtSoundCountRef.current--; }, 250);
      }
    }

    if (shombie.currentHealth <= 0) {
      onShombieKilled?.(shombie.definition.tier, shombie.position.x, shombie.position.y, shombie.position.z);

      // Death sound: the shombie's own moan, pitched down to ~0 (powering down).
      // Capped + overlapping so a horde death plays a few at once, not 100 in
      // sequence. Slots release after the power-down completes.
      if (deathSoundCountRef.current < MAX_CONCURRENT_DEATH_SOUNDS) {
        const p = getLocalPlayerSnapshot();
        const ddx = shombie.position.x - p.x;
        const ddy = shombie.position.y - p.y;
        const ddz = shombie.position.z - p.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        deathSoundCountRef.current++;
        playSpatialSound(MOAN_SOUND_URL, dist, {
          baseVolume: DEATH_SOUND_VOLUME,
          pitchDownMs: DEATH_SOUND_PITCH_DOWN_MS,
        });
        setTimeout(() => { deathSoundCountRef.current--; }, DEATH_SOUND_PITCH_DOWN_MS);
      }

      // Inter-enemy melee kill → ragdoll-launch the corpse (the shombie's
      // "explosion-like" death): a small upward+outward pop + tumble, at ~0.9
      // the momentum of a grenade-grade fling.
      if (isMeleeKill && !shombie.isTumbling) {
        const M = 0.9;
        const kx = knockbackDir?.x ?? 0;
        const kz = knockbackDir?.z ?? 1;
        const klen = Math.hypot(kx, kz) || 1;
        shombie.velocity.x = (kx / klen) * 8 * M;
        shombie.velocity.z = (kz / klen) * 8 * M;
        shombie.velocity.y = 9 * M;
        // Fall flat onto its BACK (no random spin): rotate around the horizontal
        // axis perpendicular to the knockback so it tips straight backward,
        // landing ~supine by the time it hits the ground (~0.8s fly), then
        // despawns. tumbleRate tuned so the rotation ≈ 90° at landing.
        shombie.isTumbling = true;
        shombie.tumbleAxisX = -kz / klen;
        shombie.tumbleAxisY = 0;
        shombie.tumbleAxisZ = kx / klen;
        shombie.tumbleRate = 2.0;
        shombie.tumbleLaunchAt = Date.now();
        shombie.tumbleLandedAt = 0;
      }

      // Blast-killed shombies fly as ragdoll CORPSES: keep rendering +
      // simulating so they arc + tumble through the air, then despawn when the
      // tumble finishes (in applyResult). Non-blast deaths remove immediately.
      // Either way no per-death setShombies — the once-per-second sweep compacts.
      if (shombie.isTumbling) {
        shombie.isCorpse = true;
      } else {
        shombie.isActive = false;
      }
      deadPendingRef.current = true;
      return true;
    }

    // No setState on non-fatal damage: health is read live from the instance
    // by the renderer (brightness) and combat each frame. Re-rendering per hit
    // is what stormed the GC / starved the render loop on a horde grenade.
    return false;
  }, [onShombieKilled, playerLevel]);

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

  // Register Shombie with the EnemyCombatRegistry so the universal
  // bullet + flame pipelines work without per-type code.
  useEffect(() => {
    // Reused per hit — avoids allocating a Vector3 every bullet impact.
    const dirScratch = new THREE.Vector3();
    return enemyCombatRegistry.register({
      type: 'shombie',
      getActiveEnemies: () => shombiesRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive || s.isCorpse) return null; // corpses are dead ragdolls
        const scale = s.scale ?? 1;
        return {
          centerX: s.position.x,
          centerZ: s.position.z,
          bottomY: s.position.y,
          topY: s.position.y + SHOMBIE_HITBOX_HEIGHT * scale,
          radius: SHOMBIE_HITBOX_RADIUS * scale,
        };
      },
      applyDamage: (s, info) => {
        dirScratch.set(info.knockbackDirX, info.knockbackDirY ?? 0, info.knockbackDirZ);
        // Grenade blast: pass the falloff-scaled impulse magnitude so
        // explosions actually punt shombies. Bullets keep the gentle
        // 1 m/s tap that the body-shot stun rule expects.
        const kbStrength = info.source === 'explosion'
          ? (info.bulletSpeed || 1.0)
          : info.source === 'melee'
          ? (info.knockbackImpulse ?? 12.0) // tier+damage-scaled melee impulse
          : 1.0;
        // Player damage (anything but a rival's melee) → 80% chance to break off
        // and retaliate against the player.
        if (info.source !== 'melee' && Math.random() < 0.8) {
          EnemyManager.retargetToPlayer(s.id);
        }
        return damageShombie(s.id, info.damage, dirScratch, info.isHeadshot, dirScratch, kbStrength, info.source === 'melee');
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
      // Body-relative flame points so a burn engulfs the whole humanoid and
      // tracks it as it moves / is knocked back (the global burn system updates
      // every point from the live hitbox center each frame).
      getFlameAttachPoints: (s) => {
        const sc = s.scale ?? 1;
        return [
          { yOffset: 1.7 * sc, size: 0.6 * sc, height: 0.8 * sc, particles: 12 }, // head
          { yOffset: 1.0 * sc, size: 0.8 * sc, height: 1.0 * sc, particles: 16 }, // torso
          { yOffset: 0.4 * sc, size: 0.6 * sc, height: 0.9 * sc, particles: 10 }, // legs
        ];
      },
    });
  }, [damageShombie]);

  return {
    shombies,
    shombiesRef,
    spawningEnabled,
    spawnShombie,
    spawnShombieAt,
    spawnShombieGroup,
    getDefinitionByTier,
    damageShombie,
    clearAllShombies,
  };
}
