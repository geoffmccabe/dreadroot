// Shpider system — Phase 3 (static): manages active shpider instances,
// admin/debug spawn, and a per-frame tick that's currently a no-op (the
// hop AI will land in Phase 4).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ShpiderDefinition, ShpiderInstance } from '../types';
import { LEGS_PER_SHPIDER, CHUNK_SIZE } from '../constants';

const MAX_TOTAL_SHPIDERS = 200;
const GROUP_SPREAD_RADIUS = 6;
const DEFAULT_GROUP_SIZE = 5;

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

  // Keep ref in sync with state for cheap reads from frame loops.
  useEffect(() => {
    shpidersRef.current = shpiders;
  }, [shpiders]);

  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');

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

    const instance: ShpiderInstance = {
      id,
      definition,
      position: new THREE.Vector3(worldX, 0, worldZ),
      rotation: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      spawnedAt: Date.now(),
      velocity: new THREE.Vector3(0, 0, 0),
      spawnChunkX: Math.floor(worldX / CHUNK_SIZE),
      spawnChunkZ: Math.floor(worldZ / CHUNK_SIZE),
      scale,
      legPhaseOffsets,
      headYawOffset: 0,
      headPitchOffset: 0,
      hop: {
        phase: 'idle',
        nextHopAt: Date.now() + 1000 + Math.random() * 500,
        hopStartAt: 0,
        hopDurationMs: definition.hop_duration_ms,
        startX: worldX, startY: 0, startZ: worldZ,
        endX: worldX,   endY: 0, endZ: worldZ,
        arcHeight: 0,
      },
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
   */
  useEffect(() => {
    if (!isAdmin) return;
    (window as any).__spawnShpiders = (tier = 1, count = DEFAULT_GROUP_SIZE) => {
      spawnShpiderGroup(tier, count);
    };
    return () => { delete (window as any).__spawnShpiders; };
  }, [isAdmin, spawnShpiderGroup]);

  return {
    shpiders,
    shpidersRef,
    spawnShpiderAt,
    spawnShpiderGroup,
    removeShpider,
  };
}
