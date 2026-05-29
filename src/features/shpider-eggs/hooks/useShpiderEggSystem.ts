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
import { stepEggPhysics, type VoxelCollider, type EnemyColliderSource } from '@/features/combat';

// Pure-physics function adapters around our client-side singletons.
// On the L2 DO the same physics function will receive different
// implementations of these interfaces backed by server state.
const _voxelCollider: VoxelCollider = {
  hasVoxel: (ix, iy, iz) => worldCollisionGrid.hasVoxel(ix, iy, iz),
};
const _enemyColliderSource: EnemyColliderSource = {
  forEachHitbox(cb) {
    for (const adapter of enemyCombatRegistry.getAdapters()) {
      for (const enemy of adapter.getActiveEnemies()) {
        const hb = adapter.getHitbox(enemy);
        if (hb) cb(hb);
      }
    }
  },
};
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

      // Physics + rest accumulation extracted to @/features/combat so
      // the same step runs on the L2 DO. restAccumSec is incremented
      // inside the step; the hatch trigger stays in this caller.
      stepEggPhysics(
        e,
        stepDt,
        _voxelCollider,
        _enemyColliderSource,
        {
          gravity: EGG_GRAVITY,
          bounceDamp: EGG_BOUNCE_DAMP,
          rollFrictionPerSec: EGG_ROLL_FRICTION_PER_SEC,
          visualRadius: EGG_VISUAL_RADIUS,
          restSpeed: EGG_REST_SPEED,
        },
      );

      // Hatch when rest accumulator passes the threshold.
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

      list[writeIdx++] = e;
    }
    list.length = writeIdx;
    return hatches;
  }, [onHatch]);

  // Run physics on the R3F frame clock — parity with useGrenadeSystem.
  useFrame((_, dt) => { tick(dt); });

  return { eggsRef, throwEgg, tick };
}
