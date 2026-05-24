// Shpider system — active instance list, admin/debug spawn commands,
// and the natural-spawn loop. The per-frame hop AI lives in the
// renderer (one pass over the active list does both AI tick + matrix
// building).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ShpiderDefinition, ShpiderInstance } from '../types';
import {
  LEGS_PER_SHPIDER,
  CHUNK_SIZE,
  MAX_SHPIDERS_PER_CHUNK,
  SPAWN_CHECK_INTERVAL_MS,
} from '../constants';

const MAX_TOTAL_SHPIDERS = 200;
const GROUP_SPREAD_RADIUS = 6;
const DEFAULT_GROUP_SIZE = 5;

// Only T1 spawns naturally — higher tiers come from drop tables /
// events. Matches the Shombie pattern.
const NATURAL_SPAWN_TIER = 1;
const NATURAL_SPAWN_CHUNK_RADIUS = 5;

interface UseShpiderSystemOptions {
  definitions: ShpiderDefinition[];
  cameraRef: React.RefObject<THREE.Camera | null>;
  isEnabled: boolean;
  userRoles: string[];
}

function getDefinitionByTier(defs: ShpiderDefinition[], tier: number): ShpiderDefinition | null {
  return defs.find(d => d.tier === tier) ?? null;
}

export function useShpiderSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
}: UseShpiderSystemOptions) {
  const [shpiders, setShpiders] = useState<ShpiderInstance[]>([]);
  const shpidersRef = useRef<ShpiderInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(true);

  // Keep ref in sync with state for cheap reads from frame loops.
  useEffect(() => {
    shpidersRef.current = shpiders;
  }, [shpiders]);

  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');

  /** Count active shpiders in a chunk (used by the spawn cap). */
  const countInChunk = useCallback((chunkX: number, chunkZ: number): number => {
    let n = 0;
    for (const s of shpidersRef.current) {
      if (s.isActive && s.spawnChunkX === chunkX && s.spawnChunkZ === chunkZ) n++;
    }
    return n;
  }, []);

  /** Current chunk the player is standing in. */
  const getPlayerChunk = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return null;
    return {
      x: Math.floor(cam.position.x / CHUNK_SIZE),
      z: Math.floor(cam.position.z / CHUNK_SIZE),
    };
  }, [cameraRef]);

  /** Spawn one shpider at an exact world position. */
  const spawnShpiderAt = useCallback((
    definition: ShpiderDefinition,
    worldX: number,
    worldZ: number,
  ): ShpiderInstance | null => {
    if (shpidersRef.current.length >= MAX_TOTAL_SHPIDERS) {
      console.warn('[Shpider] Max total reached');
      return null;
    }
    const id = `shpider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scale = 1 + (Math.random() * 2 - 1) * 0.15;
    const legPhaseOffsets = Array.from({ length: LEGS_PER_SHPIDER }, () => Math.random() * Math.PI * 2);

    const now = Date.now();
    const instance: ShpiderInstance = {
      id,
      definition,
      position: new THREE.Vector3(worldX, 0, worldZ),
      rotation: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      spawnedAt: now,
      velocity: new THREE.Vector3(0, 0, 0),
      spawnChunkX: Math.floor(worldX / CHUNK_SIZE),
      spawnChunkZ: Math.floor(worldZ / CHUNK_SIZE),
      scale,
      legPhaseOffsets,
      headYawOffset: 0,
      headPitchOffset: 0,
      headSlidePhase: Math.random() * Math.PI * 2,
      nextMandibleClickAt: now + 500 + Math.random() * 1500,
      mandibleClickStartedAt: 0,
      hop: {
        phase: 'idle',
        nextHopAt: now + definition.hop_interval_min_ms + Math.random() * (definition.hop_interval_max_ms - definition.hop_interval_min_ms),
        crawlStartAt: 0, crawlDurationMs: 0,
        crawlStartX: worldX, crawlStartZ: worldZ,
        crawlEndX:   worldX, crawlEndZ:   worldZ,
        hopStartAt: 0,
        hopDurationMs: definition.hop_duration_ms,
        startX: worldX, startY: 0, startZ: worldZ,
        endX: worldX,   endY: 0, endZ: worldZ,
        arcHeight: 0,
        endNormalX: 0, endNormalY: 1, endNormalZ: 0,
      },
      surfaceNormal: new THREE.Vector3(0, 1, 0),
    };

    shpidersRef.current = [...shpidersRef.current, instance];
    setShpiders(shpidersRef.current);
    return instance;
  }, []);

  /** Spawn a group near the player camera (admin/debug). */
  const spawnShpiderGroup = useCallback((tier: number, count: number = DEFAULT_GROUP_SIZE) => {
    const definition = getDefinitionByTier(definitions, tier);
    if (!definition) {
      console.warn('[Shpider] No definition for tier', tier);
      return;
    }
    const camera = cameraRef.current;
    if (!camera) return;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const baseX = camera.position.x + forward.x * 8;
    const baseZ = camera.position.z + forward.z * 8;

    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * Math.PI;
      const radius = Math.random() * GROUP_SPREAD_RADIUS;
      spawnShpiderAt(definition, baseX + Math.cos(angle) * radius, baseZ + Math.sin(angle) * radius);
    }
    console.log(`[Shpider] Spawned ${count} tier-${tier} shpiders`);
  }, [definitions, cameraRef, spawnShpiderAt]);

  /** Remove a shpider by id (used by combat later). */
  const removeShpider = useCallback((id: string) => {
    shpidersRef.current = shpidersRef.current.filter(s => s.id !== id);
    setShpiders(shpidersRef.current);
  }, []);

  /** Admin keybind: Ctrl+P spawns a group of T1 shpiders. */
  useEffect(() => {
    if (!isEnabled || !isAdmin) return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        spawnShpiderGroup(1, DEFAULT_GROUP_SIZE);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEnabled, isAdmin, spawnShpiderGroup]);

  /**
   * Window-global hooks for the browser console — same convenience the
   * other enemy systems offer.
   *   window.__spawnShpiders(tier, count) — admin only
   *   window.__toggleShpiderSpawning() — admin only
   */
  useEffect(() => {
    if (!isAdmin) return;
    (window as any).__spawnShpiders = (tier = 1, count = DEFAULT_GROUP_SIZE) => {
      spawnShpiderGroup(tier, count);
    };
    (window as any).__toggleShpiderSpawning = () => {
      setSpawningEnabled(v => {
        console.log(`[Shpider] Natural spawning: ${!v ? 'ON' : 'OFF'}`);
        return !v;
      });
    };
    return () => {
      delete (window as any).__spawnShpiders;
      delete (window as any).__toggleShpiderSpawning;
    };
  }, [isAdmin, spawnShpiderGroup]);

  /**
   * Natural spawning loop. Every SPAWN_CHECK_INTERVAL_MS we look at
   * the chunks around the player; each one rolls
   *   chance = T1.spawn_chance_per_minute
   *          × distFalloff(chunkDist)            // halves per chunk
   *          × (CHECK_INTERVAL_MS / 60000)       // 2 s window
   * to decide whether to drop one more shpider in it.
   *
   * Same distance-falloff curve as Shombie so the two enemy systems
   * feel consistent at the same chunk distance.
   */
  useEffect(() => {
    if (!isEnabled || !spawningEnabled) return;
    if (!definitions || definitions.length === 0) return;

    const tier1Def = definitions.find(d => d.tier === NATURAL_SPAWN_TIER);
    if (!tier1Def) return;
    if ((tier1Def.spawn_chance_per_minute ?? 0) <= 0) return;

    const baseChancePerMinute = tier1Def.spawn_chance_per_minute;
    console.log(`[Shpider] Natural spawning started — T1 ${baseChancePerMinute}/min, radius ${NATURAL_SPAWN_CHUNK_RADIUS} chunks`);

    const spawnCheck = () => {
      if (shpidersRef.current.length >= MAX_TOTAL_SHPIDERS) return;
      const player = getPlayerChunk();
      if (!player) return;

      for (let dx = -NATURAL_SPAWN_CHUNK_RADIUS; dx <= NATURAL_SPAWN_CHUNK_RADIUS; dx++) {
        for (let dz = -NATURAL_SPAWN_CHUNK_RADIUS; dz <= NATURAL_SPAWN_CHUNK_RADIUS; dz++) {
          const chunkDist = Math.max(Math.abs(dx), Math.abs(dz));
          if (chunkDist === 0) continue; // never spawn in the player's chunk
          const chunkX = player.x + dx;
          const chunkZ = player.z + dz;
          if (countInChunk(chunkX, chunkZ) >= MAX_SHPIDERS_PER_CHUNK) continue;

          const distMul = Math.pow(0.5, chunkDist - 1);
          const chancePerCheck = baseChancePerMinute * distMul * (SPAWN_CHECK_INTERVAL_MS / 60000);
          if (Math.random() < chancePerCheck) {
            const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
            const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
            spawnShpiderAt(tier1Def, worldX, worldZ);
          }
        }
      }
    };

    // Initial check after a short delay so the world has settled.
    const initial = setTimeout(spawnCheck, 2000);
    const interval = setInterval(spawnCheck, SPAWN_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [isEnabled, spawningEnabled, definitions, getPlayerChunk, countInChunk, spawnShpiderAt]);

  return {
    shpiders,
    shpidersRef,
    spawnShpiderAt,
    spawnShpiderGroup,
    removeShpider,
    spawningEnabled,
    setSpawningEnabled,
  };
}
