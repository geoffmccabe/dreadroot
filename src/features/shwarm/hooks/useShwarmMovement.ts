import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShwarmInstance } from './useShwarmSystem';
import { MOVEMENT_UPDATE_PRIORITY } from '../constants';

// Pre-allocated vectors for zero-allocation movement
const _toPlayer = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _newPos = new THREE.Vector3();
const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

/**
 * Seeded random number generator for deterministic movement
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface UseShwarmMovementOptions {
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
}

/**
 * Hook to update shwarm block positions each frame
 * Blocks move toward player with x_factor random variance
 */
export function useShwarmMovement({
  shwarmsRef,
  cameraRef,
  isEnabled,
}: UseShwarmMovementOptions) {
  // Per-shwarm random generators (keyed by shwarm id)
  const rngMapRef = useRef<Map<string, () => number>>(new Map());

  // Get or create RNG for a shwarm
  const getRng = useCallback((shwarmId: string, seed: number): () => number => {
    if (!rngMapRef.current.has(shwarmId)) {
      rngMapRef.current.set(shwarmId, seededRandom(seed));
    }
    return rngMapRef.current.get(shwarmId)!;
  }, []);

  // Frame loop registration
  useEffect(() => {
    if (!isEnabled) return;

    const unregister = frameLoop.register('shwarmMovement', (delta) => {
      const shwarms = shwarmsRef.current;
      const camera = cameraRef.current;
      if (!shwarms || shwarms.length === 0 || !camera) return;

      const playerPos = camera.position;

      for (const shwarm of shwarms) {
        if (!shwarm.isActive) continue;

        const { definition, blocks, seed, id: shwarmId } = shwarm;
        const speed = definition.speed;
        const xFactor = definition.x_factor;
        const rng = getRng(shwarmId, seed);

        for (const block of blocks) {
          if (!block.isAlive) continue;

          const pos = block.position;

          // Direction toward player
          _toPlayer.subVectors(playerPos, pos);
          const distToPlayer = _toPlayer.length();

          // Normalize direction (mostly horizontal)
          _toPlayer.y *= 0.2; // reduce vertical movement
          _toPlayer.normalize();

          // Add random variance based on x_factor
          // x_factor 1-10 maps to 0.1-1.0 variance
          const variance = xFactor * 0.1;
          _moveDir.set(
            _toPlayer.x + (rng() - 0.5) * variance,
            _toPlayer.y + (rng() - 0.5) * variance * 0.3, // less vertical variance
            _toPlayer.z + (rng() - 0.5) * variance
          );
          _moveDir.normalize();

          // Calculate movement distance this frame
          const moveDist = speed * delta;

          // Calculate new position
          _newPos.copy(pos).addScaledVector(_moveDir, moveDist);

          // Keep above ground
          _newPos.y = Math.max(0.25, _newPos.y);

          // Check collision with world blocks (0.5 size blocks)
          const halfSize = 0.25;
          _testMin.set(_newPos.x - halfSize, _newPos.y - halfSize, _newPos.z - halfSize);
          _testMax.set(_newPos.x + halfSize, _newPos.y + halfSize, _newPos.z + halfSize);
          _testBox.set(_testMin, _testMax);

          // Check collision grid
          const nearbyCount = collisionGrid.getNearby(_newPos.x, _newPos.z, 2);
          let blocked = false;

          for (let i = 0; i < nearbyCount; i++) {
            const collider = collisionGrid.nearbyResult[i] as THREE.Box3;
            if (_testBox.intersectsBox(collider)) {
              blocked = true;
              break;
            }
          }

          // Only move if not blocked (or if very close to player, force through)
          if (!blocked || distToPlayer < 2) {
            pos.copy(_newPos);
          } else {
            // Try to slide around obstacle
            // Try horizontal only
            _newPos.y = pos.y;
            _testMin.set(_newPos.x - halfSize, _newPos.y - halfSize, _newPos.z - halfSize);
            _testMax.set(_newPos.x + halfSize, _newPos.y + halfSize, _newPos.z + halfSize);
            _testBox.set(_testMin, _testMax);

            let stillBlocked = false;
            for (let i = 0; i < nearbyCount; i++) {
              const collider = collisionGrid.nearbyResult[i] as THREE.Box3;
              if (_testBox.intersectsBox(collider)) {
                stillBlocked = true;
                break;
              }
            }

            if (!stillBlocked) {
              pos.copy(_newPos);
            }
            // If still blocked, don't move this frame
          }
        }
      }
    }, MOVEMENT_UPDATE_PRIORITY);

    return unregister;
  }, [isEnabled, shwarmsRef, cameraRef, getRng]);

  // Cleanup RNG map when shwarms are removed
  useEffect(() => {
    const cleanup = setInterval(() => {
      const shwarms = shwarmsRef.current;
      if (!shwarms) return;

      const activeIds = new Set(shwarms.map(s => s.id));
      for (const id of rngMapRef.current.keys()) {
        if (!activeIds.has(id)) {
          rngMapRef.current.delete(id);
        }
      }
    }, 5000);

    return () => clearInterval(cleanup);
  }, [shwarmsRef]);
}
