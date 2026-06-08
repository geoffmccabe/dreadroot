import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { VortaxDefinition, VortaxInstance, HeadMovementType } from '../types';
import { generatePartTwitches, generateVortaxSpheres } from '../types';
import {
  CHUNK_SIZE,
  MAX_VORTAXES_PER_CHUNK,
  MAX_TOTAL_VORTAXES,
  SPAWN_CHECK_INTERVAL_MS,
  VORTAX_SPAWN_BOUNDS,
  VORTAX_SCALE_VARIATION,
  VORTAX_BASE_SCALE,
  VORTAX_GROUP_SPREAD_RADIUS,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import {
  VORTAX_HITBOX_RADIUS,
  VORTAX_HITBOX_HEIGHT,
  MAX_KNOCKBACK_SPEED,
  VORTAX_POP_SOUND_URL,
} from '../constants';

// Head movement type randomizer - 1/3 each
function randomHeadMovementType(): HeadMovementType {
  const rand = Math.random();
  if (rand < 0.333) return 'slide';
  if (rand < 0.666) return 'bob';
  return 'circle';
}

interface UseVortaxSystemOptions {
  definitions: VortaxDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  userRoles: string[];
  playerLevel?: number;
  onVortaxKilled?: (tier: number) => void;
}

// Audio settings (reuse the shroomer's moan for ambient/death for now)
const MOAN_SOUND_URL = '/shroomers_noises.mp3';
const MOAN_CHECK_INTERVAL_MS = 5000;
const MOAN_CHANCE = 0.1;
const MOAN_VOLUME = 0.5;

const DEATH_SOUND_VOLUME = 1.0;
const DEATH_SOUND_PITCH_DOWN_MS = 1300;
const MAX_CONCURRENT_DEATH_SOUNDS = 6;

const VORTAX_SPAWN_FREQUENCY_MULT = 1;

// Pop-sound throttle so a flamethrower destroying many spheres doesn't spam audio.
const MAX_CONCURRENT_POP_SOUNDS = 8;

// Preload vortax sounds (pop file may not exist yet — preload is best-effort)
preloadSpatialSounds([MOAN_SOUND_URL, VORTAX_POP_SOUND_URL]);

/**
 * Hook to manage active vortaxes with chunk-based spawning.
 * Cloned from the shroomer system: TIER 1 ONLY, base scale ~10, sphere-cloud
 * body, and per-sphere destructible combat (no fragmentation explosion).
 */
export function useVortaxSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
  playerLevel = 1,
  onVortaxKilled,
}: UseVortaxSystemOptions) {
  const [vortaxes, setVortaxes] = useState<VortaxInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(false);
  const vortaxesRef = useRef<VortaxInstance[]>([]);
  const popSoundCountRef = useRef(0);

  // Keep ref in sync
  useEffect(() => {
    vortaxesRef.current = vortaxes;
  }, [vortaxes]);

  // Batched dead-vortax sweep (once per second).
  const deadPendingRef = useRef(false);
  const deathSoundCountRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      deadPendingRef.current = false;
      const before = vortaxesRef.current.length;
      vortaxesRef.current = vortaxesRef.current.filter(s => s.isActive);
      if (vortaxesRef.current.length !== before) setVortaxes(vortaxesRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  void userRoles;

  /**
   * Get definition by tier (vortax is tier 1 only).
   */
  const getDefinitionByTier = useCallback((tier: number): VortaxDefinition | null => {
    // Vortax is TIER 1 ONLY — always resolve to the tier-1 definition.
    return definitions?.find(d => d.tier === 1) ?? null;
  }, [definitions]);

  /**
   * Ambient moan sounds
   */
  useEffect(() => {
    if (!isEnabled) return;

    const moanCheck = () => {
      if (vortaxesRef.current.length === 0) return;
      const p = getLocalPlayerSnapshot();

      for (const vortax of vortaxesRef.current) {
        if (!vortax.isActive) continue;
        if (Math.random() < MOAN_CHANCE) {
          const dx = vortax.position.x - p.x;
          const dy = vortax.position.y - p.y;
          const dz = vortax.position.z - p.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          playSpatialSound(MOAN_SOUND_URL, distance, { baseVolume: MOAN_VOLUME });
        }
      }
    };

    const interval = setInterval(moanCheck, MOAN_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled]);

  const getPlayerChunk = useCallback((): { x: number; z: number } | null => {
    const p = getLocalPlayerSnapshot();
    return {
      x: Math.floor(p.x / CHUNK_SIZE),
      z: Math.floor(p.z / CHUNK_SIZE),
    };
  }, []);

  const countInChunk = useCallback((chunkX: number, chunkZ: number): number => {
    return vortaxesRef.current.filter(s =>
      s.isActive && s.spawnChunkX === chunkX && s.spawnChunkZ === chunkZ
    ).length;
  }, []);

  /**
   * Spawn a vortax at a specific world position. TIER 1 ONLY, base scale ~10.
   */
  const spawnVortaxAt = useCallback((
    definition: VortaxDefinition,
    worldX: number,
    worldZ: number,
  ): VortaxInstance | null => {
    if (vortaxesRef.current.length >= MAX_TOTAL_VORTAXES) {
      console.warn('[Vortax] Max total vortaxes reached');
      return null;
    }

    const x = Math.max(VORTAX_SPAWN_BOUNDS.minX, Math.min(VORTAX_SPAWN_BOUNDS.maxX, worldX));
    const z = Math.max(VORTAX_SPAWN_BOUNDS.minZ, Math.min(VORTAX_SPAWN_BOUNDS.maxZ, worldZ));

    const id = `vortax_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // TIER 1 ONLY: fixed base scale (~10 → 20m tall) with ±20% variation.
    const scale = VORTAX_BASE_SCALE * (1 + (Math.random() * 2 - 1) * VORTAX_SCALE_VARIATION);

    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);

    const spheres = generateVortaxSpheres();

    const instance: VortaxInstance = {
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
      emergenceProgress: 0,
      partTwitches: generatePartTwitches(),
      isChasing: false,
      headMovementType: randomHeadMovementType(),
      isKnockedDown: false,
      knockdownProgress: 0,
      knockdownStartTime: 0,
      bodyFires: [],
      spheres,
      liveSphereCount: spheres.length,
    };

    vortaxesRef.current = [...vortaxesRef.current, instance];
    setVortaxes(vortaxesRef.current);

    console.log(`[Vortax] Spawned tier 1 at (${x.toFixed(1)}, ${z.toFixed(1)}) scale=${scale.toFixed(2)} spheres=${spheres.length}`);
    return instance;
  }, []);

  /**
   * Spawn a vortax in a chunk (for ambient spawning)
   */
  const spawnVortax = useCallback((
    definition: VortaxDefinition,
    chunkX: number,
    chunkZ: number
  ): VortaxInstance | null => {
    const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
    return spawnVortaxAt(definition, worldX, worldZ);
  }, [spawnVortaxAt]);

  /**
   * Spawn a group of vortaxes around the player (admin spawn command).
   * Tier is always 1.
   */
  const spawnVortaxGroup = useCallback((_tier: number, count: number) => {
    const definition = getDefinitionByTier(1);
    if (!definition) {
      console.warn('[Vortax] No tier 1 definition');
      return;
    }

    const p = getLocalPlayerSnapshot();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const baseX = p.x + fx * 25; // farther out — they're huge
    const baseZ = p.z + fz * 25;

    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * Math.PI;
      const radius = Math.random() * VORTAX_GROUP_SPREAD_RADIUS;
      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;
      spawnVortaxAt(definition, baseX + offsetX, baseZ + offsetZ);
    }

    console.log(`[Vortax] Spawned group of ${count} tier 1 vortaxes`);
  }, [getDefinitionByTier, spawnVortaxAt]);

  /**
   * Find and destroy the nearest still-alive sphere to a hit point.
   * When ALL spheres are destroyed, the vortax dies.
   * Returns true if the vortax died as a result.
   */
  const hitVortaxSphere = useCallback((
    vortaxId: string,
    hitX: number,
    hitY: number,
    hitZ: number,
    knockbackDir?: THREE.Vector3,
    kbStrength: number = 1.0,
  ): boolean => {
    const vortax = vortaxesRef.current.find(s => s.id === vortaxId);
    if (!vortax || !vortax.isActive) return false;

    vortax.lastDamagedAt = Date.now();

    // No knockback: the Vortax is unmovable — it ignores hits and keeps
    // advancing on the player. (knockbackDir/kbStrength intentionally unused.)
    void knockbackDir; void kbStrength;

    // Find the nearest still-alive sphere. Spheres orbit, so the exact world
    // position drifts; we approximate each sphere's world position from its
    // part-local orbit CENTER (cheap + stable) transformed by the instance's
    // scale + Y-rotation + position. Approximation noted for the lead.
    const sc = vortax.scale;
    const cosR = Math.cos(vortax.rotation);
    const sinR = Math.sin(vortax.rotation);

    let bestIdx = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < vortax.spheres.length; i++) {
      const s = vortax.spheres[i];
      if (s.destroyed) continue;
      // Local center → world (rotate XZ, scale, translate).
      const lx = s.centerX * sc;
      const ly = s.centerY * sc;
      const lz = s.centerZ * sc;
      const wx = vortax.position.x + (lx * cosR - lz * sinR);
      const wy = vortax.position.y + ly;
      const wz = vortax.position.z + (lx * sinR + lz * cosR);
      const dx = wx - hitX;
      const dy = wy - hitY;
      const dz = wz - hitZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }

    if (bestIdx < 0) return false; // no live spheres (shouldn't happen if hitbox gated)

    vortax.spheres[bestIdx].destroyed = true;
    vortax.liveSphereCount = Math.max(0, vortax.liveSphereCount - 1);

    // POP sound at the hit point (throttled).
    if (popSoundCountRef.current < MAX_CONCURRENT_POP_SOUNDS) {
      const p = getLocalPlayerSnapshot();
      const ddx = hitX - p.x, ddy = hitY - p.y, ddz = hitZ - p.z;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      popSoundCountRef.current++;
      playSpatialSound(VORTAX_POP_SOUND_URL, dist, { baseVolume: 0.6 });
      setTimeout(() => { popSoundCountRef.current--; }, 300);
    }

    // All spheres destroyed → the vortax dies.
    if (vortax.liveSphereCount <= 0) {
      onVortaxKilled?.(vortax.definition.tier);

      if (deathSoundCountRef.current < MAX_CONCURRENT_DEATH_SOUNDS) {
        const p = getLocalPlayerSnapshot();
        const ddx = vortax.position.x - p.x;
        const ddy = vortax.position.y - p.y;
        const ddz = vortax.position.z - p.z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        deathSoundCountRef.current++;
        playSpatialSound(MOAN_SOUND_URL, dist, {
          baseVolume: DEATH_SOUND_VOLUME,
          pitchDownMs: DEATH_SOUND_PITCH_DOWN_MS,
        });
        setTimeout(() => { deathSoundCountRef.current--; }, DEATH_SOUND_PITCH_DOWN_MS);
      }

      vortax.isActive = false;
      deadPendingRef.current = true;
      return true;
    }

    return false;
  }, [onVortaxKilled]);

  const clearAllVortaxes = useCallback(() => {
    vortaxesRef.current = [];
    setVortaxes([]);
  }, []);

  /**
   * Chunk-based natural spawn loop
   */
  useEffect(() => {
    if (!isEnabled || !spawningEnabled) return;
    if (!definitions || definitions.length === 0) return;

    const tier1Def = definitions.find(d => d.tier === 1);
    if (!tier1Def) return;

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
          if (countInChunk(chunkX, chunkZ) >= MAX_VORTAXES_PER_CHUNK) continue;

          const baseChancePerMinute = tier1Def.spawn_chance_per_minute * VORTAX_SPAWN_FREQUENCY_MULT;
          const distanceMultiplier = Math.pow(0.5, chunkDist - 1);
          const chancePerMinute = baseChancePerMinute * distanceMultiplier;
          const chancePerCheck = chancePerMinute * (SPAWN_CHECK_INTERVAL_MS / 60000);

          if (Math.random() < chancePerCheck) {
            spawnVortax(tier1Def, chunkX, chunkZ);
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
  }, [isEnabled, spawningEnabled, definitions, getPlayerChunk, countInChunk, spawnVortax]);

  // Register Vortax with the EnemyCombatRegistry. The hitbox encloses the whole
  // 20m body — but ONLY while there are still live spheres. applyDamage routes
  // through the nearest-sphere destructor.
  useEffect(() => {
    const dirScratch = new THREE.Vector3();
    return enemyCombatRegistry.register({
      type: 'vortax',
      getActiveEnemies: () => vortaxesRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive || s.liveSphereCount <= 0) return null;
        const scale = s.scale ?? 1;
        return {
          centerX: s.position.x,
          centerZ: s.position.z,
          bottomY: s.position.y,
          topY: s.position.y + VORTAX_HITBOX_HEIGHT * scale,
          radius: VORTAX_HITBOX_RADIUS * scale,
        };
      },
      applyDamage: (s, info) => {
        dirScratch.set(info.knockbackDirX, info.knockbackDirY ?? 0, info.knockbackDirZ);
        const kbScale = s.definition.knockback_received ?? 1;
        const kbStrength = info.source === 'explosion'
          ? (info.bulletSpeed || 1.0)
          : 11 * kbScale * Math.max(1, (info.bulletSpeed || 0) / 60) / (s.scale ?? 1);
        return hitVortaxSphere(s.id, info.hitX, info.hitY, info.hitZ, dirScratch, kbStrength);
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
      // Flames engulf the whole giant. Scaled to the 20m body.
      getFlameAttachPoints: (s) => {
        const sc = s.scale ?? 1;
        return [
          { yOffset: 1.5 * sc, size: 0.7 * sc, height: 0.8 * sc, particles: 12 },
          { yOffset: 0.9 * sc, size: 0.8 * sc, height: 1.0 * sc, particles: 16 },
          { yOffset: 0.3 * sc, size: 0.6 * sc, height: 0.9 * sc, particles: 10 },
        ];
      },
    });
  }, [hitVortaxSphere]);

  void cameraRef;
  void playerLevel;

  return {
    vortaxes,
    vortaxesRef,
    spawningEnabled,
    setSpawningEnabled,
    spawnVortax,
    spawnVortaxAt,
    spawnVortaxGroup,
    getDefinitionByTier,
    hitVortaxSphere,
    clearAllVortaxes,
  };
}
