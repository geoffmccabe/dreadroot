// Throwable Shpider Egg system. Modeled on useGrenadeSystem but
// with a "hatch on rest" trigger instead of a fuse timer. When the
// egg's speed stays below EGG_REST_SPEED for EGG_REST_HATCH_SEC,
// we spawn a pet shpider at the egg's current position and remove
// the egg from the world.

import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { ShpiderEggInstance } from '../types';
import {
  EGG_THROW_SPEED, EGG_THROW_UP, EGG_GRAVITY, EGG_BOUNCE_DAMP,
  EGG_ROLL_FRICTION_PER_SEC, EGG_VISUAL_RADIUS, EGG_REST_SPEED,
  EGG_REST_HATCH_SEC, MAX_LIVE_EGGS,
} from '../constants';

interface UseShpiderEggSystemOptions {
  cameraRef: React.RefObject<THREE.Camera>;
  /** Called when an egg hatches. Implementation spawns a pet shpider
   *  of the given tier at position with ownerUserId + eggInventoryRowId
   *  attached. */
  onHatch?: (params: {
    tier: number;
    position: THREE.Vector3;
    eggInventoryRowId: string;
  }) => void;
}

export interface HatchResult {
  tier: number;
  position: THREE.Vector3;
}

export function useShpiderEggSystem({
  cameraRef,
  onHatch,
}: UseShpiderEggSystemOptions) {
  const eggsRef = useRef<ShpiderEggInstance[]>([]);
  const nextIdRef = useRef(1);

  const throwEgg = useCallback((tier: number, eggInventoryRowId: string): boolean => {
    if (eggsRef.current.length >= MAX_LIVE_EGGS) return false;
    const cam = cameraRef.current;
    if (!cam) return false;

    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const horizMag = Math.hypot(lookDir.x, lookDir.z) || 1;
    const vx = (lookDir.x / horizMag) * EGG_THROW_SPEED;
    const vz = (lookDir.z / horizMag) * EGG_THROW_SPEED;
    const vy = EGG_THROW_UP + lookDir.y * EGG_THROW_SPEED * 0.6;

    const spawn = new THREE.Vector3(
      cam.position.x + (lookDir.x / horizMag) * 0.5,
      cam.position.y - 0.2,
      cam.position.z + (lookDir.z / horizMag) * 0.5,
    );

    eggsRef.current.push({
      id: `egg${nextIdRef.current++}`,
      tier,
      eggInventoryRowId,
      position: spawn,
      velocity: new THREE.Vector3(vx, vy, vz),
      spawnedAt: performance.now() / 1000,
      restAccumSec: 0,
      hatched: false,
    });
    return true;
  }, [cameraRef]);

  const _scratchToEnemy = useRef(new THREE.Vector3()).current;

  /** Per-frame physics + rest detection. Returns the list of hatch
   *  events that fired this frame (caller can use for stats/VFX). */
  const tick = useCallback((dt: number): HatchResult[] => {
    const hatches: HatchResult[] = [];
    const list = eggsRef.current;
    const stepDt = Math.min(dt, 0.05);

    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.hatched) continue;

      // Integrate
      e.velocity.y -= EGG_GRAVITY * stepDt;
      const nextX = e.position.x + e.velocity.x * stepDt;
      const nextY = e.position.y + e.velocity.y * stepDt;
      const nextZ = e.position.z + e.velocity.z * stepDt;
      let px = nextX, py = nextY, pz = nextZ;
      const r = EGG_VISUAL_RADIUS;

      // Y collision (floor / ceiling)
      const yCellNext = Math.floor(nextY - r);
      if (e.velocity.y < 0 && worldCollisionGrid.hasVoxel(Math.floor(e.position.x), yCellNext, Math.floor(e.position.z))) {
        py = yCellNext + 1 + r + 0.001;
        e.velocity.y = -e.velocity.y * EGG_BOUNCE_DAMP;
        e.velocity.x *= 0.8;
        e.velocity.z *= 0.8;
      } else if (e.velocity.y > 0 && worldCollisionGrid.hasVoxel(Math.floor(e.position.x), Math.floor(nextY + r), Math.floor(e.position.z))) {
        py = Math.floor(nextY + r) - r - 0.001;
        e.velocity.y = -e.velocity.y * EGG_BOUNCE_DAMP;
      } else if (nextY - r < 0) {
        py = r + 0.001;
        e.velocity.y = -e.velocity.y * EGG_BOUNCE_DAMP;
        e.velocity.x *= 0.8;
        e.velocity.z *= 0.8;
      }
      // X / Z walls
      if (e.velocity.x !== 0) {
        const xCell = Math.floor(e.velocity.x > 0 ? nextX + r : nextX - r);
        if (worldCollisionGrid.hasVoxel(xCell, Math.floor(py), Math.floor(e.position.z))) {
          px = e.position.x;
          e.velocity.x = -e.velocity.x * EGG_BOUNCE_DAMP;
        }
      }
      if (e.velocity.z !== 0) {
        const zCell = Math.floor(e.velocity.z > 0 ? nextZ + r : nextZ - r);
        if (worldCollisionGrid.hasVoxel(Math.floor(px), Math.floor(py), zCell)) {
          pz = e.position.z;
          e.velocity.z = -e.velocity.z * EGG_BOUNCE_DAMP;
        }
      }

      // Entity bounce (same shape as grenade) — bounce off enemy cylinders
      for (const adapter of enemyCombatRegistry.getAdapters()) {
        for (const enemy of adapter.getActiveEnemies()) {
          const hb = adapter.getHitbox(enemy);
          if (!hb) continue;
          if (py + r < hb.bottomY || py - r > hb.topY) continue;
          const dx = px - hb.centerX;
          const dz = pz - hb.centerZ;
          const distSq = dx * dx + dz * dz;
          const reach = hb.radius + r;
          if (distSq > reach * reach) continue;
          const dist = Math.sqrt(distSq) || 0.001;
          const nx = dx / dist, nz = dz / dist;
          px = hb.centerX + nx * (reach + 0.001);
          pz = hb.centerZ + nz * (reach + 0.001);
          const vDotN = e.velocity.x * nx + e.velocity.z * nz;
          if (vDotN < 0) {
            e.velocity.x -= 2 * vDotN * nx;
            e.velocity.z -= 2 * vDotN * nz;
            e.velocity.x *= EGG_BOUNCE_DAMP;
            e.velocity.z *= EGG_BOUNCE_DAMP;
          }
        }
      }

      e.position.set(px, py, pz);

      // Friction while grounded so the egg comes to rest.
      const grounded = Math.abs(e.velocity.y) < 1.5
        && (py - r <= 0.05
            || worldCollisionGrid.hasVoxel(Math.floor(px), Math.floor(py - r - 0.05), Math.floor(pz)));
      if (grounded) {
        const decay = Math.pow(EGG_ROLL_FRICTION_PER_SEC, stepDt);
        e.velocity.x *= decay;
        e.velocity.z *= decay;
        if (e.velocity.y < 0) e.velocity.y = 0;
      }

      // Rest detection — hatch when speed stays under threshold long enough.
      const speed = Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
      if (speed < EGG_REST_SPEED && grounded) {
        e.restAccumSec += stepDt;
        if (e.restAccumSec >= EGG_REST_HATCH_SEC) {
          e.hatched = true;
          onHatch?.({
            tier: e.tier,
            position: e.position.clone(),
            eggInventoryRowId: e.eggInventoryRowId,
          });
          hatches.push({ tier: e.tier, position: e.position.clone() });
          continue; // drop from list
        }
      } else {
        e.restAccumSec = 0;
      }

      list[writeIdx++] = e;
    }
    list.length = writeIdx;
    return hatches;
  }, [onHatch]);

  // Run physics on the R3F frame clock — parity with useGrenadeSystem.
  useFrame((_, dt) => { tick(dt); });

  return { eggsRef, throwEgg, tick };
}
