import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { frameLoop } from '@/lib/frameLoop';
import type { ShwarmInstance } from './useShwarmSystem';
import type { ShwarmBlock } from '../types';
import { PLAYER_HIT_RADIUS, PLAYER_HIT_DEBOUNCE_MS, MOVE_TOWARDS_PLAYER, SHWARM_BLOCK_SIZE, MIN_SHWARM_SPACING, MOVEMENT_PHASE_MS, GRAVITY_FALL, GROUND_LEVEL } from '../constants';
import { playSpatialSound, SHWARM_SOUNDS } from '@/lib/spatialAudio';

// Maximum center pull multiplier (when far from center)
const MAX_CENTER_PULL_MULTIPLIER = 3.0;

// Interpolation speed (lerp factor per frame, adjusted by delta)
const LERP_SPEED = 8;

// Pre-allocated vectors for zero-allocation movement
const _toPlayer = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _centerOfMass = new THREE.Vector3();
const _newPos = new THREE.Vector3();
const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

// Pre-allocated for shwarm collider updates
const _colliderMin = new THREE.Vector3();
const _colliderMax = new THREE.Vector3();

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

/**
 * Extended block with target position for interpolation
 * Plus visual offset for randomness within the buffer zone
 */
interface BlockTargetData {
  targetPosition: THREE.Vector3;
  visualOffset: THREE.Vector3; // Random offset within buffer for visual variety
  collider: THREE.Box3 | null; // Collider for player standing
  nextMoveTime: number; // When this block should next move (ms timestamp)
}

interface UseShwarmMovementOptions {
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  /** When true, AI system controls movement - legacy loop is disabled */
  aiControlled?: boolean;
  onPlayerHit?: (damage: number, knockbackForce: number, direction: THREE.Vector3) => void;
}

/**
 * Hook to update shwarm block positions in 1-second phases with smooth interpolation
 * Blocks move toward player with random variance, respect spacing, and have gravity
 */
export function useShwarmMovement({
  shwarmsRef,
  cameraRef,
  isEnabled,
  aiControlled = false,
  onPlayerHit,
}: UseShwarmMovementOptions) {
  // Per-shwarm random generators (keyed by shwarm id)
  const rngMapRef = useRef<Map<string, () => number>>(new Map());
  
  // Target positions for interpolation (keyed by block id)
  const blockTargetsRef = useRef<Map<string, BlockTargetData>>(new Map());

  // Get or create RNG for a shwarm
  const getRng = useCallback((shwarmId: string, seed: number): () => number => {
    if (!rngMapRef.current.has(shwarmId)) {
      rngMapRef.current.set(shwarmId, seededRandom(seed));
    }
    return rngMapRef.current.get(shwarmId)!;
  }, []);

  // Get or create target data for a block (including collider for player standing)
  const getBlockTarget = useCallback((block: ShwarmBlock): BlockTargetData => {
    if (!blockTargetsRef.current.has(block.id)) {
      // Initialize with random visual offset within buffer
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3, // +/- 0.15m
        0,
        (Math.random() - 0.5) * 0.3
      );
      
      // Create collider for player standing (0.5m cube)
      const halfSize = SHWARM_BLOCK_SIZE / 2;
      const collider = new THREE.Box3(
        new THREE.Vector3(
          block.position.x - halfSize,
          block.position.y - halfSize,
          block.position.z - halfSize
        ),
        new THREE.Vector3(
          block.position.x + halfSize,
          block.position.y + halfSize,
          block.position.z + halfSize
        )
      );
      // Add to collision grid so player can stand on it
      collisionGrid.insert(collider);
      
      // Stagger initial move: random time within first 0.5-1.5s window
      const nextMoveTime = Date.now() + 500 + Math.random() * 1000;
      
      blockTargetsRef.current.set(block.id, {
        targetPosition: block.position.clone(),
        visualOffset: offset,
        collider,
        nextMoveTime,
      });
    }
    return blockTargetsRef.current.get(block.id)!;
  }, []);

  // Check if a position is too close to other shwarm blocks
  const isTooCloseToOthers = useCallback((
    pos: THREE.Vector3,
    currentBlock: ShwarmBlock,
    allBlocks: ShwarmBlock[]
  ): boolean => {
    for (const other of allBlocks) {
      if (other === currentBlock || !other.isAlive) continue;
      
      // Use target positions for collision checking
      const otherTarget = blockTargetsRef.current.get(other.id);
      const otherPos = otherTarget?.targetPosition ?? other.position;
      
      const dx = pos.x - otherPos.x;
      const dy = pos.y - otherPos.y;
      const dz = pos.z - otherPos.z;
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

  // Frame loop for smooth interpolation AND continuous player hit detection
  useEffect(() => {
    // When AI controls movement, legacy interpolation still runs (for smooth rendering)
    // but movement decisions come from AI
    if (!isEnabled) return;

    const unregister = frameLoop.register('shwarmInterpolation', (delta) => {
      const shwarms = shwarmsRef.current;
      const camera = cameraRef.current;
      if (!shwarms || shwarms.length === 0 || !camera) return;

      const playerPos = camera.position;
      const now = Date.now();
      const lerpFactor = Math.min(1, LERP_SPEED * delta);

      for (const shwarm of shwarms) {
        const { definition, blocks } = shwarm;
        const tier = definition.tier;
        const damagePerHit = definition.damage_per_hit;

        for (const block of blocks) {
          // Immediately remove colliders for dead blocks OR inactive shwarms
          if (!block.isAlive || !shwarm.isActive) {
            const target = blockTargetsRef.current.get(block.id);
            if (target?.collider) {
              collisionGrid.remove(target.collider);
              target.collider = null;
              blockTargetsRef.current.delete(block.id);
            }
            continue;
          }

          const target = getBlockTarget(block);
          
          // Calculate visual position: target + visual offset for variety within buffer
          const visualTarget = _newPos.copy(target.targetPosition).add(target.visualOffset);
          
          // Smooth interpolation: lerp visual position toward target + offset
          block.position.lerp(visualTarget, lerpFactor);

          // Update collider position to match block position (for player standing)
          if (target.collider) {
            const halfSize = SHWARM_BLOCK_SIZE / 2;
            _colliderMin.set(
              block.position.x - halfSize,
              block.position.y - halfSize,
              block.position.z - halfSize
            );
            _colliderMax.set(
              block.position.x + halfSize,
              block.position.y + halfSize,
              block.position.z + halfSize
            );
            // OPTIMIZATION: Use update() which skips remove+insert if cell unchanged
            target.collider.set(_colliderMin, _colliderMax);
            collisionGrid.update(target.collider);
          }

          // Continuous player collision check (not just during phases)
          const distToPlayer = block.position.distanceTo(playerPos);
          
          if (distToPlayer < PLAYER_HIT_RADIUS && onPlayerHit) {
            if (!block.lastHitPlayerAt || now - block.lastHitPlayerAt > PLAYER_HIT_DEBOUNCE_MS) {
              block.lastHitPlayerAt = now;
              
              // Knockback force: 1 + tier
              const knockbackForce = 1 + tier;
              
              // Direction: from block to player
              const knockbackDir = _toPlayer.subVectors(playerPos, block.position).normalize();
              knockbackDir.y = 0.3;
              knockbackDir.normalize();
              
              onPlayerHit(damagePerHit, knockbackForce, knockbackDir.clone());
            }
          }
        }
      }
    }, 60); // After controls

    return unregister;
  }, [isEnabled, shwarmsRef, cameraRef, onPlayerHit, getBlockTarget]);

  // Movement phase - check every 100ms, each block has its own timer (0.5-1.5s)
  useEffect(() => {
    // When AI controls movement, this legacy movement loop is disabled
    if (!isEnabled || aiControlled) return;

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
        const rng = getRng(shwarmId, seed);

        // x_factor for random range: Tier 1 = 3, scales with tier
        const randomRange = 2 + tier;

        // Calculate center of mass for this shwarm's alive blocks
        _centerOfMass.set(0, 0, 0);
        let aliveCount = 0;
        for (const block of blocks) {
          if (!block.isAlive) continue;
          const target = blockTargetsRef.current.get(block.id);
          const pos = target?.targetPosition ?? block.position;
          _centerOfMass.add(pos);
          aliveCount++;
        }
        if (aliveCount > 0) {
          _centerOfMass.divideScalar(aliveCount);
        }
        
        // Cache center of mass for ShwarmAdapter.getPosition() O(1) lookup
        // This avoids O(blockCount) iteration every frame for LOD checks
        if (!(shwarm as any).__aiCenter) {
          (shwarm as any).__aiCenter = { x: 0, y: 0, z: 0 };
        }
        (shwarm as any).__aiCenter.x = _centerOfMass.x;
        (shwarm as any).__aiCenter.y = _centerOfMass.y;
        (shwarm as any).__aiCenter.z = _centerOfMass.z;

        for (const block of blocks) {
          if (!block.isAlive) continue;

          const target = getBlockTarget(block);
          
          // Check if it's time for this block to move
          if (now < target.nextMoveTime) continue;
          
          // Schedule next move: 0.5 to 1.5 seconds from now
          target.nextMoveTime = now + 500 + Math.random() * 1000;
          
          // 1% chance to play a shwarm sound on movement
          if (Math.random() < 0.01) {
            const soundIndex = Math.floor(Math.random() * SHWARM_SOUNDS.length);
            const distToPlayer = block.position.distanceTo(playerPos);
            playSpatialSound(SHWARM_SOUNDS[soundIndex], distToPlayer, {
              baseVolume: 0.6,
              playbackRate: 0.9 + Math.random() * 0.2, // Slight pitch variation
            });
          }
          
          const currentTargetPos = target.targetPosition;

          // Calculate direction toward player (horizontal mainly)
          _toPlayer.subVectors(playerPos, currentTargetPos);
          _toPlayer.y = 0; // Horizontal only for direction
          
          if (_toPlayer.length() < 0.5) {
            continue; // Too close, don't move
          }
          
          _toPlayer.normalize();

          // Calculate direction toward center of mass (horizontal)
          _toCenter.subVectors(_centerOfMass, currentTargetPos);
          _toCenter.y = 0;
          const distToCenter = _toCenter.length();
          
          // Distance-weighted center pull: farther blocks get pulled stronger
          // At distance 0: pull = 0.5, at distance 10+: pull = MAX_CENTER_PULL_MULTIPLIER
          const centerPullStrength = Math.min(
            MAX_CENTER_PULL_MULTIPLIER,
            0.5 + (distToCenter / 5) * (MAX_CENTER_PULL_MULTIPLIER - 0.5)
          );
          
          if (distToCenter > 0.1) {
            _toCenter.normalize();
          } else {
            _toCenter.set(0, 0, 0);
          }

          // Random offset: +/- randomRange in each axis (integer steps for blocky feel)
          const randX = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));
          const randY = Math.floor(rng() * 2); // 0 or 1 up (step-up)
          const randZ = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));

          // Calculate new position: toward player + distance-weighted toward center + random offset
          _newPos.copy(currentTargetPos);
          _newPos.x += _toPlayer.x * MOVE_TOWARDS_PLAYER + _toCenter.x * centerPullStrength + randX;
          _newPos.z += _toPlayer.z * MOVE_TOWARDS_PLAYER + _toCenter.z * centerPullStrength + randZ;
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
            // Valid move - update target position
            target.targetPosition.copy(_newPos);
            // Randomize visual offset each movement for bubbling effect
            target.visualOffset.set(
              (rng() - 0.5) * 0.3,
              0,
              (rng() - 0.5) * 0.3
            );
          } else if (tooClose && !collidesWorld) {
            // Blocked by another shwarm - try stacking on top (0.5m up)
            _newPos.y = currentTargetPos.y + 0.5;
            if (!isTooCloseToOthers(_newPos, block, allBlocks) && !checkWorldCollision(_newPos)) {
              target.targetPosition.copy(_newPos);
              target.visualOffset.set(
                (rng() - 0.5) * 0.3,
                0,
                (rng() - 0.5) * 0.3
              );
            } else {
              // Try stacking even higher (1m up)
              _newPos.y = currentTargetPos.y + 1.0;
              if (!isTooCloseToOthers(_newPos, block, allBlocks) && !checkWorldCollision(_newPos)) {
                target.targetPosition.copy(_newPos);
                target.visualOffset.set(
                  (rng() - 0.5) * 0.3,
                  0,
                  (rng() - 0.5) * 0.3
                );
              }
              // Else: stay in place this phase
            }
          } else if (collidesWorld) {
            // Try step-up over world obstacle
            _newPos.y = currentTargetPos.y + 1;
            if (!checkWorldCollision(_newPos) && !isTooCloseToOthers(_newPos, block, allBlocks)) {
              target.targetPosition.copy(_newPos);
              target.visualOffset.set(
                (rng() - 0.5) * 0.3,
                0,
                (rng() - 0.5) * 0.3
              );
            }
            // Else: stay in place, blocked
          }
        }
      }
    }, 100); // Check every 100ms for per-block timers

    return () => clearInterval(intervalId);
  }, [isEnabled, aiControlled, shwarmsRef, cameraRef, getRng, checkWorldCollision, isTooCloseToOthers, getBlockTarget]);

  // Cleanup maps and colliders when shwarms/blocks are removed
  useEffect(() => {
    const cleanup = setInterval(() => {
      const shwarms = shwarmsRef.current;
      if (!shwarms) return;

      const activeBlockIds = new Set<string>();
      const activeShwarmIds = new Set<string>();
      
      for (const shwarm of shwarms) {
        activeShwarmIds.add(shwarm.id);
        for (const block of shwarm.blocks) {
          if (block.isAlive) {
            activeBlockIds.add(block.id);
          }
        }
      }
      
      // Cleanup RNG map
      for (const id of rngMapRef.current.keys()) {
        if (!activeShwarmIds.has(id)) {
          rngMapRef.current.delete(id);
        }
      }
      
      // Cleanup target positions and remove colliders from grid
      for (const [id, target] of blockTargetsRef.current.entries()) {
        if (!activeBlockIds.has(id)) {
          // Remove collider from collision grid so player doesn't collide with dead blocks
          if (target.collider) {
            collisionGrid.remove(target.collider);
          }
          blockTargetsRef.current.delete(id);
        }
      }
    }, 1000); // Faster cleanup interval as safety net

    return () => clearInterval(cleanup);
  }, [shwarmsRef]);
}
