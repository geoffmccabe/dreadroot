import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShwarmInstance } from './useShwarmSystem';
import type { ShwarmBlock } from '../types';
import { PLAYER_HIT_RADIUS, PLAYER_HIT_DEBOUNCE_MS } from '../constants';

// Movement phase interval (1 second)
const MOVEMENT_PHASE_MS = 1000;

// Minimum distance between shwarm block centers
const MIN_SHWARM_SPACING = 1.0;

// Gravity: fall 1 unit per phase if above ground
const GRAVITY_FALL = 1.0;

// Ground level
const GROUND_LEVEL = 0.25; // Half of 0.5 block size

// Pre-allocated vectors for zero-allocation movement
const _toPlayer = new THREE.Vector3();
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
 * Hook to update shwarm block positions in 1-second phases
 * Blocks move toward player with random variance, respect spacing, and have gravity
 */
export function useShwarmMovement({
  shwarmsRef,
  cameraRef,
  isEnabled,
  onPlayerHit,
}: UseShwarmMovementOptions) {
  // Per-shwarm random generators (keyed by shwarm id)
  const rngMapRef = useRef<Map<string, () => number>>(new Map());
  const lastPhaseTimeRef = useRef<number>(0);

  // Get or create RNG for a shwarm
  const getRng = useCallback((shwarmId: string, seed: number): () => number => {
    if (!rngMapRef.current.has(shwarmId)) {
      rngMapRef.current.set(shwarmId, seededRandom(seed));
    }
    return rngMapRef.current.get(shwarmId)!;
  }, []);

  // Check if a position is too close to other shwarm blocks
  const isTooCloseToOthers = useCallback((
    pos: THREE.Vector3,
    currentBlock: ShwarmBlock,
    allBlocks: ShwarmBlock[]
  ): boolean => {
    for (const other of allBlocks) {
      if (other === currentBlock || !other.isAlive) continue;
      
      const dx = pos.x - other.position.x;
      const dy = pos.y - other.position.y;
      const dz = pos.z - other.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      
      if (distSq < MIN_SHWARM_SPACING * MIN_SHWARM_SPACING) {
        return true;
      }
    }
    return false;
  }, []);

  // Check collision with world blocks
  const checkWorldCollision = useCallback((pos: THREE.Vector3): boolean => {
    const halfSize = 0.25;
    _testMin.set(pos.x - halfSize, pos.y - halfSize, pos.z - halfSize);
    _testMax.set(pos.x + halfSize, pos.y + halfSize, pos.z + halfSize);
    _testBox.set(_testMin, _testMax);

    const nearbyCount = collisionGrid.getNearby(pos.x, pos.z, 2);
    for (let i = 0; i < nearbyCount; i++) {
      const collider = collisionGrid.nearbyResult[i] as THREE.Box3;
      if (_testBox.intersectsBox(collider)) {
        return true;
      }
    }
    return false;
  }, []);

  // Movement phase using setInterval (1 second phases)
  useEffect(() => {
    if (!isEnabled) return;

    const intervalId = setInterval(() => {
      const shwarms = shwarmsRef.current;
      const camera = cameraRef.current;
      if (!shwarms || shwarms.length === 0 || !camera) return;

      const playerPos = camera.position;
      const now = Date.now();

      // Collect all alive blocks for inter-shwarm collision checking
      const allBlocks: ShwarmBlock[] = [];
      for (const shwarm of shwarms) {
        if (!shwarm.isActive) continue;
        for (const block of shwarm.blocks) {
          if (block.isAlive) {
            allBlocks.push(block);
          }
        }
      }

      for (const shwarm of shwarms) {
        if (!shwarm.isActive) continue;

        const { definition, blocks, seed, id: shwarmId } = shwarm;
        const tier = definition.tier;
        const damagePerHit = definition.damage_per_hit;
        const rng = getRng(shwarmId, seed);

        // x_factor for random range: Tier 1 = 3, scales with tier
        // We'll use: 3 + (tier - 1) so tier 1 = 3, tier 5 = 7, tier 10 = 12
        const randomRange = 2 + tier;

        for (const block of blocks) {
          if (!block.isAlive) continue;

          const pos = block.position;

          // Check player collision first
          const distToPlayer = pos.distanceTo(playerPos);
          
          if (distToPlayer < PLAYER_HIT_RADIUS && onPlayerHit) {
            if (!block.lastHitPlayerAt || now - block.lastHitPlayerAt > PLAYER_HIT_DEBOUNCE_MS) {
              block.lastHitPlayerAt = now;
              
              // Knockback force: 1 + tier
              const knockbackForce = 1 + tier;
              
              // Direction: from block to player
              const knockbackDir = _toPlayer.subVectors(playerPos, pos).normalize();
              knockbackDir.y = 0.3;
              knockbackDir.normalize();
              
              onPlayerHit(damagePerHit, knockbackForce, knockbackDir.clone());
            }
          }

          // Calculate direction toward player (horizontal mainly)
          _toPlayer.subVectors(playerPos, pos);
          _toPlayer.y = 0; // Horizontal only for direction
          
          if (_toPlayer.length() < 0.5) {
            continue; // Too close, don't move
          }
          
          _toPlayer.normalize();

          // Random offset: +/- randomRange in each axis (integer steps for blocky feel)
          const randX = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));
          const randY = Math.floor(rng() * 2); // 0 or 1 up (step-up)
          const randZ = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));

          // Calculate new position: 1 step toward player + random offset
          _newPos.copy(pos);
          _newPos.x += Math.round(_toPlayer.x) + randX;
          _newPos.z += Math.round(_toPlayer.z) + randZ;
          _newPos.y += randY; // Can step up

          // Apply gravity: if above ground, fall 1 unit
          if (_newPos.y > GROUND_LEVEL + 0.5) {
            _newPos.y -= GRAVITY_FALL;
          }

          // Clamp to ground
          _newPos.y = Math.max(GROUND_LEVEL, _newPos.y);

          // Check if new position is valid:
          // 1. Not colliding with world blocks
          // 2. Not too close to other shwarm blocks
          const collidesWorld = checkWorldCollision(_newPos);
          const tooClose = isTooCloseToOthers(_newPos, block, allBlocks);

          if (!collidesWorld && !tooClose) {
            // Valid move - snap to new position (bubbling effect)
            pos.copy(_newPos);
          } else if (!collidesWorld) {
            // Try just horizontal movement if spacing is the issue
            _newPos.y = pos.y;
            if (!isTooCloseToOthers(_newPos, block, allBlocks)) {
              pos.copy(_newPos);
            }
            // Else: stay in place this phase
          } else {
            // Try step-up over obstacle
            _newPos.y = pos.y + 1;
            if (!checkWorldCollision(_newPos) && !isTooCloseToOthers(_newPos, block, allBlocks)) {
              pos.copy(_newPos);
            }
            // Else: stay in place, blocked
          }
        }
      }

      lastPhaseTimeRef.current = now;
    }, MOVEMENT_PHASE_MS);

    return () => clearInterval(intervalId);
  }, [isEnabled, shwarmsRef, cameraRef, getRng, onPlayerHit, checkWorldCollision, isTooCloseToOthers]);

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
