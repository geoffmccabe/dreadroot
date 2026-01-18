import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShwarmInstance } from './useShwarmSystem';
import { MOVEMENT_UPDATE_PRIORITY, PLAYER_HIT_RADIUS, PLAYER_HIT_DEBOUNCE_MS } from '../constants';

// Pre-allocated vectors for zero-allocation movement
const _toPlayer = new THREE.Vector3();
const _randomOffset = new THREE.Vector3();
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
  onPlayerHit?: (damage: number, knockbackForce: number, direction: THREE.Vector3) => void;
}

/**
 * Hook to update shwarm block positions each frame
 * Blocks move toward player with random variance (+/- 1 in random direction per step)
 * Also handles player collision detection
 */
export function useShwarmMovement({
  shwarmsRef,
  cameraRef,
  isEnabled,
  onPlayerHit,
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
      const now = Date.now();

      for (const shwarm of shwarms) {
        if (!shwarm.isActive) continue;

        const { definition, blocks, seed, id: shwarmId } = shwarm;
        const speed = definition.speed;
        const xFactor = definition.x_factor;
        const tier = definition.tier;
        const damagePerHit = definition.damage_per_hit;
        const rng = getRng(shwarmId, seed);

        for (const block of blocks) {
          if (!block.isAlive) continue;

          const pos = block.position;

          // Check player collision first
          const distToPlayer = pos.distanceTo(playerPos);
          
          if (distToPlayer < PLAYER_HIT_RADIUS && onPlayerHit) {
            // Check debounce
            if (!block.lastHitPlayerAt || now - block.lastHitPlayerAt > PLAYER_HIT_DEBOUNCE_MS) {
              block.lastHitPlayerAt = now;
              
              // Calculate knockback force: 1 + tier (e.g., tier 6 = 7 knockback)
              const knockbackForce = 1 + tier;
              
              // Direction: from block to player
              const knockbackDir = _toPlayer.subVectors(playerPos, pos).normalize();
              knockbackDir.y = 0.3; // Add some upward component
              knockbackDir.normalize();
              
              onPlayerHit(damagePerHit, knockbackForce, knockbackDir.clone());
              
              // Also knock back the block (opposite direction)
              pos.addScaledVector(knockbackDir, -knockbackForce * 0.5);
            }
          }

          // Direction toward player (mostly horizontal)
          _toPlayer.subVectors(playerPos, pos);
          _toPlayer.y *= 0.2; // reduce vertical movement
          
          if (_toPlayer.length() > 0.1) {
            _toPlayer.normalize();
          } else {
            continue; // Too close, don't move
          }

          // KEY FIX: Each block takes 1 step toward player + random offset
          // x_factor 1-10 controls how much random variance (1=10%, 10=100%)
          const randomStrength = xFactor * 0.1;
          
          // Random offset: +/- 1 in random direction each step
          _randomOffset.set(
            (rng() - 0.5) * 2 * randomStrength, // -1 to +1 * strength
            (rng() - 0.5) * 0.5 * randomStrength, // less vertical
            (rng() - 0.5) * 2 * randomStrength
          );

          // Calculate movement distance this frame
          const moveDist = speed * delta;

          // Calculate new position: move toward player + random offset
          _newPos.copy(pos);
          _newPos.addScaledVector(_toPlayer, moveDist);
          _newPos.add(_randomOffset.multiplyScalar(moveDist));

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
            // Try to slide around obstacle - horizontal only
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
  }, [isEnabled, shwarmsRef, cameraRef, getRng, onPlayerHit]);

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
