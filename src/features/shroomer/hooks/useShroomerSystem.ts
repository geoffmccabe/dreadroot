import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShroomerDefinition, ShroomerInstance, HeadMovementType } from '../types';
import { generatePartTwitches } from '../types';
import {
  CHUNK_SIZE,
  MAX_SHROOMERS_PER_CHUNK,
  MAX_TOTAL_SHROOMERS,
  SPAWN_CHECK_INTERVAL_MS,
  SHROOMER_SPAWN_BOUNDS,
  SHROOMER_SCALE_VARIATION,
  SHROOMER_T1_SCALE,
  SHROOMER_TIER_GROWTH,
  SHROOMER_GROUP_SPREAD_RADIUS,
  KNOCKDOWN_SLIDE_DISTANCE_PER_LEVEL,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { EnemyManager } from '@/features/enemies/ai/EnemyManager';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import { SHROOMER_HITBOX_RADIUS, SHROOMER_HITBOX_HEIGHT, MAX_KNOCKBACK_SPEED, TUMBLE_RATE_MIN, TUMBLE_RATE_MAX, EXPLODE_DURATION_MS } from '../constants';

// Head movement type randomizer - 1/3 each
function randomHeadMovementType(): HeadMovementType {
  const rand = Math.random();
  if (rand < 0.333) return 'slide';
  if (rand < 0.666) return 'bob';
  return 'circle';
}

interface UseShroomerSystemOptions {
  definitions: ShroomerDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  /** User roles for admin hotkey access */
  userRoles: string[];
  /** Player's current level (for knockback distance calculation) */
  playerLevel?: number;
  onShroomerKilled?: (tier: number) => void;
  /** Fired when a HEADSHOT lands the killing blow — triggers the explosion FX. */
  onShroomerHeadExplode?: (x: number, y: number, z: number, tier: number) => void;
}

// Audio settings (reuse shombie's moan — shroomer shares shombie sounds)
const MOAN_SOUND_URL = '/shroomers_noises.mp3';
const HURT_SOUND_URL = '/shroomer_hurt.mp3';
const HURT_SOUND_VOLUME = 0.7;
const MAX_CONCURRENT_HURT_SOUNDS = 6;
const MOAN_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
const MOAN_CHANCE = 0.1; // 10% chance per zombie per check
const MOAN_VOLUME = 0.5; // 50% volume

// Death sound: the shroomer's own moan pitched down to ~0 — powering down.
const DEATH_SOUND_VOLUME = 1.0;
const DEATH_SOUND_PITCH_DOWN_MS = 1300;
const MAX_CONCURRENT_DEATH_SOUNDS = 6;

// Shroomers use the shombie spawn rules but spawn 10× as frequently.
const SHROOMER_SPAWN_FREQUENCY_MULT = 10;

// Preload shroomer sounds
preloadSpatialSounds([MOAN_SOUND_URL, HURT_SOUND_URL]);

/**
 * Hook to manage active shroomers with chunk-based spawning.
 * Ctrl+Z (shared admin toggle) is owned by the Shombie system; shroomers
 * are spawned via the !7 admin command and natural spawning is gated by
 * `spawningEnabled` here too.
 */
export function useShroomerSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
  playerLevel = 1,
  onShroomerKilled,
  onShroomerHeadExplode,
}: UseShroomerSystemOptions) {
  const [shroomers, setShroomers] = useState<ShroomerInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(false);
  const shroomersRef = useRef<ShroomerInstance[]>([]);

  // Keep ref in sync
  useEffect(() => {
    shroomersRef.current = shroomers;
  }, [shroomers]);

  // Batched dead-shroomer sweep (once per second).
  const deadPendingRef = useRef(false);
  const deathSoundCountRef = useRef(0);
  const hurtSoundCountRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      deadPendingRef.current = false;
      const before = shroomersRef.current.length;
      shroomersRef.current = shroomersRef.current.filter(s => s.isActive);
      if (shroomersRef.current.length !== before) setShroomers(shroomersRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Check if user is admin
  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');

  /**
   * Get definition by tier
   */
  const getDefinitionByTier = useCallback((tier: number): ShroomerDefinition | null => {
    // 0 means tier 10
    const actualTier = tier === 0 ? 10 : tier;
    return definitions?.find(d => d.tier === actualTier) ?? null;
  }, [definitions]);

  /**
   * Ambient moan sounds - 10% chance per shroomer every 5 seconds
   */
  useEffect(() => {
    if (!isEnabled) return;

    const moanCheck = () => {
      if (shroomersRef.current.length === 0) return;
      const p = getLocalPlayerSnapshot();

      for (const shroomer of shroomersRef.current) {
        if (!shroomer.isActive) continue;
        if (Math.random() < MOAN_CHANCE) {
          const dx = shroomer.position.x - p.x;
          const dy = shroomer.position.y - p.y;
          const dz = shroomer.position.z - p.z;
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
   * Count shroomers in a specific chunk
   */
  const countInChunk = useCallback((chunkX: number, chunkZ: number): number => {
    return shroomersRef.current.filter(s =>
      s.isActive && s.spawnChunkX === chunkX && s.spawnChunkZ === chunkZ
    ).length;
  }, []);

  /**
   * Spawn a shroomer at a specific world position with scale variation and emergence
   */
  const spawnShroomerAt = useCallback((
    definition: ShroomerDefinition,
    worldX: number,
    worldZ: number,
  ): ShroomerInstance | null => {
    if (shroomersRef.current.length >= MAX_TOTAL_SHROOMERS) {
      console.warn('[Shroomer] Max total shroomers reached');
      return null;
    }

    // Clamp to bounds
    const x = Math.max(SHROOMER_SPAWN_BOUNDS.minX, Math.min(SHROOMER_SPAWN_BOUNDS.maxX, worldX));
    const z = Math.max(SHROOMER_SPAWN_BOUNDS.minZ, Math.min(SHROOMER_SPAWN_BOUNDS.maxZ, worldZ));

    const id = `shroomer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Size: T1 is 50% of the base model; +30% (additive) per tier above T1, so
    // T10 = 0.5 × (1 + 0.3×9) = 1.85 (i.e. +270% over T1). Scales the WHOLE
    // model (cylinders, head, cap together). Then ±20% per-instance variation.
    const tierScale = SHROOMER_T1_SCALE * (1 + SHROOMER_TIER_GROWTH * ((definition.tier ?? 1) - 1));
    const scale = tierScale * (1 + (Math.random() * 2 - 1) * SHROOMER_SCALE_VARIATION);

    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);

    const instance: ShroomerInstance = {
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
      headMovementType: randomHeadMovementType(),
      isKnockedDown: false,
      knockdownProgress: 0,
      knockdownStartTime: 0,
      bodyFires: [],
    };

    shroomersRef.current = [...shroomersRef.current, instance];
    setShroomers(shroomersRef.current);

    console.log(`[Shroomer] Spawned tier ${definition.tier} at (${x.toFixed(1)}, ${z.toFixed(1)}) scale=${scale.toFixed(2)}`);
    return instance;
  }, []);

  /**
   * Spawn a shroomer in a chunk (for ambient spawning)
   */
  const spawnShroomer = useCallback((
    definition: ShroomerDefinition,
    chunkX: number,
    chunkZ: number
  ): ShroomerInstance | null => {
    const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;

    const clusterSize = 1 + Math.floor(Math.random() * 5);
    let first: ShroomerInstance | null = null;
    for (let i = 0; i < clusterSize; i++) {
      const ox = (Math.random() - 0.5) * 2 * SHROOMER_GROUP_SPREAD_RADIUS;
      const oz = (Math.random() - 0.5) * 2 * SHROOMER_GROUP_SPREAD_RADIUS;
      const s = spawnShroomerAt(definition, worldX + ox, worldZ + oz);
      if (s && !first) first = s;
    }
    return first;
  }, [spawnShroomerAt]);

  /**
   * Spawn a group of shroomers around player position (for admin spawn commands)
   * If tier is 0, spawns 10 shroomers of tier 10
   */
  const spawnShroomerGroup = useCallback((tier: number, count: number) => {
    const spawnCount = tier === 0 ? 10 : count;

    const definition = getDefinitionByTier(tier);
    if (!definition) {
      console.warn(`[Shroomer] No definition for tier ${tier}`);
      return;
    }

    const p = getLocalPlayerSnapshot();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const baseX = p.x + fx * 8;
    const baseZ = p.z + fz * 8;

    for (let i = 0; i < spawnCount; i++) {
      const angle = (Math.random() - 0.5) * Math.PI; // Semicircle in front
      const radius = Math.random() * SHROOMER_GROUP_SPREAD_RADIUS;

      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;

      spawnShroomerAt(definition, baseX + offsetX, baseZ + offsetZ);
    }

    console.log(`[Shroomer] Spawned group of ${spawnCount} tier ${definition.tier} shroomers`);
  }, [cameraRef, getDefinitionByTier, spawnShroomerAt]);

  /**
   * Damage a shroomer
   */
  const damageShroomer = useCallback((
    shroomerId: string,
    damage: number,
    knockbackDir?: THREE.Vector3,
    isHeadshot: boolean = false,
    bulletDirection?: THREE.Vector3,
    kbStrength: number = 1.0,
    /** Inter-enemy melee kill → also fragment (cap up, parts out), at reduced
     *  momentum vs a grenade-headshot fragmentation. */
    isMeleeKill: boolean = false,
  ): boolean => {
    const shroomer = shroomersRef.current.find(s => s.id === shroomerId);
    if (!shroomer || !shroomer.isActive || shroomer.isCorpse) return false;

    shroomer.currentHealth -= damage;
    shroomer.lastDamagedAt = Date.now();

    if (knockbackDir) {
      shroomer.velocity.x = knockbackDir.x * kbStrength;
      shroomer.velocity.z = knockbackDir.z * kbStrength;
      if (knockbackDir.y > 0) {
        // Explosion (grenade): launch into the air and tumble — send them
        // flying. Grenades pass an upward knockback component; bullets don't.
        shroomer.velocity.y = knockbackDir.y * kbStrength;
        const sp2 = shroomer.velocity.x * shroomer.velocity.x
          + shroomer.velocity.y * shroomer.velocity.y
          + shroomer.velocity.z * shroomer.velocity.z;
        if (sp2 > MAX_KNOCKBACK_SPEED * MAX_KNOCKBACK_SPEED) {
          const sc = MAX_KNOCKBACK_SPEED / Math.sqrt(sp2);
          shroomer.velocity.x *= sc;
          shroomer.velocity.y *= sc;
          shroomer.velocity.z *= sc;
        }
        const ax = Math.random() * 2 - 1;
        const ay = Math.random() * 2 - 1;
        const az = Math.random() * 2 - 1;
        const inv = 1 / (Math.hypot(ax, ay, az) || 1);
        shroomer.isTumbling = true;
        shroomer.tumbleAxisX = ax * inv;
        shroomer.tumbleAxisY = ay * inv;
        shroomer.tumbleAxisZ = az * inv;
        shroomer.tumbleRate = TUMBLE_RATE_MIN + Math.random() * (TUMBLE_RATE_MAX - TUMBLE_RATE_MIN);
        shroomer.tumbleLaunchAt = Date.now();
        shroomer.tumbleLandedAt = 0;
        shroomer.stunUntil = Date.now() + 1000;
      } else {
        // Bullet: simple shpider-style horizontal shove — no vertical, no
        // tumble, no sideways slide.
        shroomer.velocity.y = 0;
        const sp = Math.hypot(shroomer.velocity.x, shroomer.velocity.z);
        if (sp > MAX_KNOCKBACK_SPEED) {
          const sc = MAX_KNOCKBACK_SPEED / sp;
          shroomer.velocity.x *= sc;
          shroomer.velocity.z *= sc;
        }
        shroomer.stunUntil = Date.now() + 400;
      }
    }

    // Non-fatal hit → "hurt" sound (in sync with the damage + knockback above).
    if (shroomer.currentHealth > 0) {
      if (hurtSoundCountRef.current < MAX_CONCURRENT_HURT_SOUNDS) {
        const p = getLocalPlayerSnapshot();
        const hdx = shroomer.position.x - p.x;
        const hdy = shroomer.position.y - p.y;
        const hdz = shroomer.position.z - p.z;
        const hdist = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
        hurtSoundCountRef.current++;
        playSpatialSound(HURT_SOUND_URL, hdist, { baseVolume: HURT_SOUND_VOLUME });
        setTimeout(() => { hurtSoundCountRef.current--; }, 250);
      }
    }

    if (shroomer.currentHealth <= 0) {
      onShroomerKilled?.(shroomer.definition.tier);

      // Fragmentation explosion (cap up, parts out): on a headshot kill (full
      // momentum) OR an inter-enemy melee kill (90% momentum — "not a giant
      // grenade blast").
      if (isHeadshot || isMeleeKill) {
        const sc = shroomer.scale ?? 1;
        shroomer.isExploding = true;
        shroomer.explodeStartTime = Date.now();
        shroomer.explodeSeed = Math.random() * Math.PI * 2;
        shroomer.explodeMomentum = isHeadshot ? 1.0 : 0.9;
        shroomer.velocity.set(0, 0, 0);
        onShroomerHeadExplode?.(
          shroomer.position.x,
          shroomer.position.y + 1.7 * sc, // head sphere height (under the cap)
          shroomer.position.z,
          shroomer.definition.tier,
        );
      }

      if (deathSoundCountRef.current < MAX_CONCURRENT_DEATH_SOUNDS) {
        const p = getLocalPlayerSnapshot();
        const ddx = shroomer.position.x - p.x;
        const ddy = shroomer.position.y - p.y;
        const ddz = shroomer.position.z - p.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        deathSoundCountRef.current++;
        playSpatialSound(MOAN_SOUND_URL, dist, {
          baseVolume: DEATH_SOUND_VOLUME,
          pitchDownMs: DEATH_SOUND_PITCH_DOWN_MS,
        });
        setTimeout(() => { deathSoundCountRef.current--; }, DEATH_SOUND_PITCH_DOWN_MS);
      }

      if (shroomer.isExploding) {
        // Keep it rendered (parts flying) for the explosion, then remove.
        const target = shroomer;
        setTimeout(() => {
          target.isActive = false;
          deadPendingRef.current = true;
        }, EXPLODE_DURATION_MS);
      } else if (shroomer.isTumbling) {
        // Blast-killed while airborne → keep flying as a ragdoll corpse.
        shroomer.isCorpse = true;
      } else {
        shroomer.isActive = false;
      }
      deadPendingRef.current = true;
      return true;
    }

    return false;
  }, [onShroomerKilled, onShroomerHeadExplode, playerLevel]);

  /**
   * Clear all shroomers (e.g., on respawn)
   */
  const clearAllShroomers = useCallback(() => {
    shroomersRef.current = [];
    setShroomers([]);
  }, []);

  /**
   * Chunk-based natural spawn loop
   */
  useEffect(() => {
    if (!isEnabled || !spawningEnabled) {
      return;
    }

    if (!definitions || definitions.length === 0) {
      console.log('[Shroomer] Natural spawning enabled but no definitions loaded');
      return;
    }

    const tier1Def = definitions.find(d => d.tier === 1);
    if (!tier1Def) {
      console.log('[Shroomer] No tier 1 definition found');
      return;
    }

    console.log(`[Shroomer] Natural spawning loop started, tier1 spawn_chance=${tier1Def.spawn_chance_per_minute}/min`);

    const spawnCheck = () => {
      const playerChunk = getPlayerChunk();
      if (!playerChunk) return;

      const maxChunkDist = 5;

      for (let dx = -maxChunkDist; dx <= maxChunkDist; dx++) {
        for (let dz = -maxChunkDist; dz <= maxChunkDist; dz++) {
          const chunkX = playerChunk.x + dx;
          const chunkZ = playerChunk.z + dz;
          const chunkDist = Math.max(Math.abs(dx), Math.abs(dz));

          if (chunkDist === 0) continue;

          if (countInChunk(chunkX, chunkZ) >= MAX_SHROOMERS_PER_CHUNK) continue;

          // Shroomers spawn by the same rules as shombies but 10× as often.
          const baseChancePerMinute = tier1Def.spawn_chance_per_minute * SHROOMER_SPAWN_FREQUENCY_MULT;
          const distanceMultiplier = Math.pow(0.5, chunkDist - 1);
          const chancePerMinute = baseChancePerMinute * distanceMultiplier;
          const chancePerCheck = chancePerMinute * (SPAWN_CHECK_INTERVAL_MS / 60000);

          if (Math.random() < chancePerCheck) {
            spawnShroomer(tier1Def, chunkX, chunkZ);
          }
        }
      }
    };

    const initialTimer = setTimeout(spawnCheck, 2000);
    const interval = setInterval(spawnCheck, SPAWN_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isEnabled, spawningEnabled, definitions, getPlayerChunk, countInChunk, spawnShroomer]);

  // Register Shroomer with the EnemyCombatRegistry so the universal
  // bullet + flame pipelines work without per-type code.
  useEffect(() => {
    const dirScratch = new THREE.Vector3();
    return enemyCombatRegistry.register({
      type: 'shroomer',
      getActiveEnemies: () => shroomersRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive || s.isCorpse || s.isExploding) return null;
        const scale = s.scale ?? 1;
        return {
          centerX: s.position.x,
          centerZ: s.position.z,
          bottomY: s.position.y,
          topY: s.position.y + SHROOMER_HITBOX_HEIGHT * scale,
          radius: SHROOMER_HITBOX_RADIUS * scale,
        };
      },
      applyDamage: (s, info) => {
        dirScratch.set(info.knockbackDirX, info.knockbackDirY ?? 0, info.knockbackDirZ);
        // Shpider-style knockback: a clean backward slide. Scaled by this tier's
        // knockback_received AND inversely by size — so bigger, higher-tier
        // shroomers get shoved back noticeably less. Explosions keep their own
        // blast magnitude.
        const kbScale = s.definition.knockback_received ?? 1;
        const kbStrength = info.source === 'explosion'
          ? (info.bulletSpeed || 1.0)
          : info.source === 'melee'
          ? 4.0 // melee shove from another enemy (doubled for a clearer reaction)
          : 11 * kbScale * Math.max(1, (info.bulletSpeed || 0) / 60) / (s.scale ?? 1);
        // Player damage (anything but a rival's melee) → 80% chance to break off
        // and retaliate against the player.
        if (info.source !== 'melee' && Math.random() < 0.8) {
          EnemyManager.retargetToPlayer(s.id);
        }
        return damageShroomer(s.id, info.damage, dirScratch, info.isHeadshot, dirScratch, kbStrength, info.source === 'melee');
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
      // Body-relative flame points (head sphere under the cap, torso, legs) so a
      // burn engulfs the whole shroomer and tracks it as it moves / is knocked
      // back. No flame on the mushroom cap.
      getFlameAttachPoints: (s) => {
        const sc = s.scale ?? 1;
        return [
          { yOffset: 1.5 * sc, size: 0.7 * sc, height: 0.8 * sc, particles: 12 }, // head sphere
          { yOffset: 0.9 * sc, size: 0.8 * sc, height: 1.0 * sc, particles: 16 }, // torso
          { yOffset: 0.3 * sc, size: 0.6 * sc, height: 0.9 * sc, particles: 10 }, // legs
        ];
      },
    });
  }, [damageShroomer]);

  return {
    shroomers,
    shroomersRef,
    spawningEnabled,
    setSpawningEnabled,
    spawnShroomer,
    spawnShroomerAt,
    spawnShroomerGroup,
    getDefinitionByTier,
    damageShroomer,
    clearAllShroomers,
  };
}
