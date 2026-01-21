/**
 * ShwarmLocomotion - Movement execution for Shwarms
 * 
 * Phase 4: Extracted from useShwarmMovement to be called by ShwarmAdapter.applyResult
 * Contains the core movement logic without React hook dependencies.
 */

import * as THREE from 'three';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
import type { ShwarmBlock } from '@/features/shwarm/types';
import type { BehaviorResult } from '../types';
import { SHWARM_BLOCK_SIZE, GROUND_LEVEL } from '@/features/shwarm/constants';

// Pre-allocated vectors for zero-allocation movement
const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

/**
 * Block target data maintained by the locomotion system.
 * Stored externally (in ShwarmAdapter or a shared Map) to persist across ticks.
 */
export interface ShwarmBlockTarget {
  targetPosition: THREE.Vector3;
  visualOffset: THREE.Vector3;
  collider: THREE.Box3 | null;
  nextMoveTime: number;
}

/**
 * Context needed for shwarm movement execution
 */
export interface ShwarmLocomotionContext {
  playerX: number;
  playerY: number;
  playerZ: number;
  blockTargets: Map<string, ShwarmBlockTarget>;
  rng: () => number;
  tier: number;
}

/**
 * Check collision with world blocks
 */
function checkWorldCollision(pos: THREE.Vector3): boolean {
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
}

/**
 * Check if a position is too close to other shwarm blocks
 */
function isTooCloseToOthers(
  pos: THREE.Vector3,
  currentBlock: ShwarmBlock,
  allBlocks: ShwarmBlock[],
  blockTargets: Map<string, ShwarmBlockTarget>,
  minSpacing: number
): boolean {
  for (const other of allBlocks) {
    if (other === currentBlock || !other.isAlive) continue;

    const otherTarget = blockTargets.get(other.id);
    const otherPos = otherTarget?.targetPosition ?? other.position;

    const dx = pos.x - otherPos.x;
    const dy = pos.y - otherPos.y;
    const dz = pos.z - otherPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq < minSpacing * minSpacing) {
      return true;
    }
  }
  return false;
}

/**
 * Get or create target data for a block
 */
export function getOrCreateBlockTarget(
  block: ShwarmBlock,
  blockTargets: Map<string, ShwarmBlockTarget>
): ShwarmBlockTarget {
  if (!blockTargets.has(block.id)) {
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      0,
      (Math.random() - 0.5) * 0.3
    );

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
    collisionGrid.insert(collider);

    const nextMoveTime = Date.now() + 500 + Math.random() * 1000;

    blockTargets.set(block.id, {
      targetPosition: block.position.clone(),
      visualOffset: offset,
      collider,
      nextMoveTime,
    });
  }
  return blockTargets.get(block.id)!;
}

/**
 * Apply a move result to a shwarm - updates target positions for all blocks.
 * 
 * Note: Shwarm movement is unique - each block moves independently toward the target.
 * The AI provides a single target (player position) and each block calculates its own path.
 * 
 * @param shwarm The shwarm instance to move
 * @param result The behavior result (must be kind: 'move')
 * @param ctx Locomotion context
 * @param allBlocks All alive blocks across all shwarms (for spacing checks)
 */
export function applyShwarmMove(
  shwarm: ShwarmInstance,
  result: Extract<BehaviorResult, { kind: 'move' }>,
  ctx: ShwarmLocomotionContext,
  allBlocks: ShwarmBlock[]
): void {
  const now = Date.now();
  const { blockTargets, rng, tier } = ctx;
  
  // Movement config from AI result
  const targetX = result.tx;
  const targetY = result.ty;
  const targetZ = result.tz;
  const speedMult = result.speedMultiplier ?? 1;

  // Random range scales with tier
  const randomRange = 2 + tier;

  // Calculate center of mass for this shwarm
  const centerOfMass = new THREE.Vector3(0, 0, 0);
  let aliveCount = 0;
  for (const block of shwarm.blocks) {
    if (!block.isAlive) continue;
    const target = blockTargets.get(block.id);
    const pos = target?.targetPosition ?? block.position;
    centerOfMass.add(pos);
    aliveCount++;
  }
  if (aliveCount > 0) {
    centerOfMass.divideScalar(aliveCount);
  }

  const MAX_CENTER_PULL_MULTIPLIER = 3.0;
  const MOVE_TOWARDS_PLAYER = 2;
  const MIN_SHWARM_SPACING = 0.6;

  for (const block of shwarm.blocks) {
    if (!block.isAlive) continue;

    const blockTarget = getOrCreateBlockTarget(block, blockTargets);

    // Check if it's time for this block to move
    if (now < blockTarget.nextMoveTime) continue;

    // Schedule next move, adjusted by speed multiplier
    const baseInterval = 500 + Math.random() * 1000;
    blockTarget.nextMoveTime = now + baseInterval / speedMult;

    const currentPos = blockTarget.targetPosition;

    // Direction toward target (from AI)
    const toTarget = new THREE.Vector3(targetX - currentPos.x, 0, targetZ - currentPos.z);
    if (toTarget.length() < 0.5) continue;
    toTarget.normalize();

    // Direction toward center of mass
    const toCenter = new THREE.Vector3().subVectors(centerOfMass, currentPos);
    toCenter.y = 0;
    const distToCenter = toCenter.length();

    const centerPullStrength = Math.min(
      MAX_CENTER_PULL_MULTIPLIER,
      0.5 + (distToCenter / 5) * (MAX_CENTER_PULL_MULTIPLIER - 0.5)
    );

    if (distToCenter > 0.1) {
      toCenter.normalize();
    } else {
      toCenter.set(0, 0, 0);
    }

    // Random offset
    const randX = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));
    const randY = Math.floor(rng() * 2);
    const randZ = Math.floor((rng() - 0.5) * 2 * (randomRange + 1));

    // Calculate new position
    const newPos = new THREE.Vector3().copy(currentPos);
    newPos.x += toTarget.x * MOVE_TOWARDS_PLAYER + toCenter.x * centerPullStrength + randX;
    newPos.z += toTarget.z * MOVE_TOWARDS_PLAYER + toCenter.z * centerPullStrength + randZ;
    newPos.y += randY;

    // Gravity
    if (newPos.y > GROUND_LEVEL + 0.5) {
      newPos.y -= 1;
    }
    newPos.y = Math.max(GROUND_LEVEL, newPos.y);

    // Validate move
    const collidesWorld = checkWorldCollision(newPos);
    const tooClose = isTooCloseToOthers(newPos, block, allBlocks, blockTargets, MIN_SHWARM_SPACING);

    if (!collidesWorld && !tooClose) {
      blockTarget.targetPosition.copy(newPos);
      blockTarget.visualOffset.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
    } else if (tooClose && !collidesWorld) {
      // Try stacking
      newPos.y = currentPos.y + 0.5;
      if (!isTooCloseToOthers(newPos, block, allBlocks, blockTargets, MIN_SHWARM_SPACING) && !checkWorldCollision(newPos)) {
        blockTarget.targetPosition.copy(newPos);
        blockTarget.visualOffset.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
      }
    } else if (collidesWorld) {
      // Try step-up
      newPos.y = currentPos.y + 1;
      if (!checkWorldCollision(newPos) && !isTooCloseToOthers(newPos, block, allBlocks, blockTargets, MIN_SHWARM_SPACING)) {
        blockTarget.targetPosition.copy(newPos);
        blockTarget.visualOffset.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
      }
    }
  }
}

/**
 * Apply an attack result to a shwarm - execute player damage.
 */
export function applyShwarmAttack(
  shwarm: ShwarmInstance,
  result: Extract<BehaviorResult, { kind: 'attack' }>,
  block: ShwarmBlock,
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void
): void {
  const now = Date.now();

  // Debounce per-block
  if (block.lastHitPlayerAt && now - block.lastHitPlayerAt < 1000) {
    return;
  }

  block.lastHitPlayerAt = now;

  if (onPlayerHit) {
    const dir = new THREE.Vector3(result.dirX, result.dirY, result.dirZ);
    onPlayerHit(result.damage, result.knockback, dir);
  }
}
