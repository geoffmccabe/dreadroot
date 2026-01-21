/**
 * ShnakeLocomotion - Movement execution for Shnakes
 * 
 * Phase 4: Extracted from useShnakeMovement to be called by ShnakeAdapter.applyResult
 * Phase 6.1: Optimized for zero-allocation hot path
 */

import * as THREE from 'three';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShnakeInstance } from '@/features/shnake/types';
import type { PlantedTree } from '@/features/trees/types';
import type { BehaviorResult } from '../types';

const CHUNK_SIZE = 16;

// Pre-allocated Box3 for head collider creation (reused, then cloned only on assignment)
const _tempBox = new THREE.Box3();
const _tempMin = new THREE.Vector3();
const _tempMax = new THREE.Vector3();

// Pre-allocated for collision checks (O(1) spatial lookup)
const _cellBox = new THREE.Box3();
const _cellMin = new THREE.Vector3();
const _cellMax = new THREE.Vector3();

// Pre-allocated attack direction vector
const _attackDir = new THREE.Vector3();

// Numeric key packing for zero-allocation occupied set
const KEY_BASE = 4096;
const KEY_OFF = 2048;
function posKey(x: number, y: number, z: number): number {
  return (x + KEY_OFF) + (y + KEY_OFF) * KEY_BASE + (z + KEY_OFF) * KEY_BASE * KEY_BASE;
}

// Reusable occupied set (cleared each tick, never reallocated)
const _occupiedSet = new Set<number>();

// Cache for tree chunk keys (avoids recomputing per tick)
const treeChunksCache = new Map<string, Set<string>>();

function chunkKey(x: number, z: number) {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

/**
 * Create an AABB for a cell position.
 * Uses pre-allocated vectors but returns a NEW Box3 (colliders must be unique per segment).
 */
function aabbForCell(x: number, y: number, z: number): THREE.Box3 {
  _tempMin.set(x, y, z);
  _tempMax.set(x + 1, y + 1, z + 1);
  return new THREE.Box3(_tempMin.clone(), _tempMax.clone());
}

function treeBounds(tree: PlantedTree) {
  const tier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
  const maxSpread = tier * 2;
  const maxHeight = tier * 10;
  return {
    minX: tree.base_x - maxSpread,
    maxX: tree.base_x + maxSpread,
    minY: tree.base_y,
    maxY: tree.base_y + maxHeight,
    minZ: tree.base_z - maxSpread,
    maxZ: tree.base_z + maxSpread,
    tier,
  };
}

function getTreeChunkKeys(tree: PlantedTree): Set<string> {
  const b = treeBounds(tree);
  const chunks = new Set<string>();
  const minCx = Math.floor(b.minX / CHUNK_SIZE);
  const maxCx = Math.floor(b.maxX / CHUNK_SIZE);
  const minCz = Math.floor(b.minZ / CHUNK_SIZE);
  const maxCz = Math.floor(b.maxZ / CHUNK_SIZE);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      chunks.add(`${cx},${cz}`);
    }
  }
  return chunks;
}

/**
 * Get cached tree chunk keys (avoids allocation per tick)
 */
function getCachedTreeChunks(tree: PlantedTree): Set<string> {
  let chunks = treeChunksCache.get(tree.id);
  if (!chunks) {
    chunks = getTreeChunkKeys(tree);
    treeChunksCache.set(tree.id, chunks);
  }
  return chunks;
}

export interface ShnakeLocomotionContext {
  tree: PlantedTree;
  treeBlocksByTier: Map<number, Map<string, string>> | null;
  canGoToGround: boolean;
  onHeadMoved?: (shnakeId: string) => void;
}

/**
 * Check if position is adjacent to any tree block of this tier.
 * OPTIMIZED: Direct neighbor checks instead of array allocation.
 */
function isTouchingTree(
  tier: number,
  x: number,
  y: number,
  z: number,
  treeBlocksByTier: Map<number, Map<string, string>> | null
): boolean {
  const tierMap = treeBlocksByTier?.get(tier);
  if (!tierMap) return false;

  // Direct checks - no array allocation
  if (tierMap.has(`${x + 1},${y},${z}`)) return true;
  if (tierMap.has(`${x - 1},${y},${z}`)) return true;
  if (tierMap.has(`${x},${y + 1},${z}`)) return true;
  if (tierMap.has(`${x},${y - 1},${z}`)) return true;
  if (tierMap.has(`${x},${y},${z + 1}`)) return true;
  if (tierMap.has(`${x},${y},${z - 1}`)) return true;

  return false;
}

/**
 * Check if position is within tree's chunk bounds
 * OPTIMIZED: Uses cached chunk keys
 */
function isInTreeChunks(tree: PlantedTree, x: number, z: number): boolean {
  const treeChunks = getCachedTreeChunks(tree);
  const ck = chunkKey(x, z);
  return treeChunks.has(ck);
}

/**
 * Check if cell is occupied by world blocks using O(1) spatial lookup
 * OPTIMIZED: Uses collisionGrid instead of O(n) block scan
 */
function isCellOccupiedByWorld(x: number, y: number, z: number): boolean {
  _cellMin.set(x + 0.1, y + 0.1, z + 0.1);
  _cellMax.set(x + 0.9, y + 0.9, z + 0.9);
  _cellBox.set(_cellMin, _cellMax);

  const nearbyCount = collisionGrid.getNearby(x + 0.5, z + 0.5, 2);
  for (let i = 0; i < nearbyCount; i++) {
    const box = collisionGrid.nearbyResult[i] as THREE.Box3;
    if (_cellBox.intersectsBox(box)) return true;
  }
  return false;
}

/**
 * Apply a move result to a shnake - core movement execution.
 * OPTIMIZED: Zero-allocation hot path with in-place array shifting.
 * 
 * @param shnake The shnake instance to move
 * @param result The behavior result (must be kind: 'move')
 * @param ctx Locomotion context with tree, blocks, etc.
 */
export function applyShnakeMove(
  shnake: ShnakeInstance,
  result: Extract<BehaviorResult, { kind: 'move' }>,
  ctx: ShnakeLocomotionContext
): void {
  const segs = shnake.segments;
  const cols = shnake.colliders;
  const headSeg = segs[0];
  const length = segs.length;
  const tail = segs[length - 1];

  // Build occupied set using numeric keys (zero string allocation)
  _occupiedSet.clear();
  for (let i = 0; i < length; i++) {
    const seg = segs[i];
    _occupiedSet.add(posKey(seg.x, seg.y, seg.z));
  }
  // Allow moving into current tail cell because it vacates this step
  _occupiedSet.delete(posKey(tail.x, tail.y, tail.z));

  const candidates = [
    [1, 0, 0], [-1, 0, 0],
    [0, 0, 1], [0, 0, -1],
    [0, 1, 0], [0, -1, 0],
  ] as const;

  // Target from AI behavior
  const targetX = Math.floor(result.tx);
  const targetY = Math.floor(result.ty);
  const targetZ = Math.floor(result.tz);

  const scored: Array<{ dx: number; dy: number; dz: number; score: number }> = [];

  for (const [dx, dy, dz] of candidates) {
    const nx = headSeg.x + dx;
    const ny = headSeg.y + dy;
    const nz = headSeg.z + dz;

    // CHUNK CONSTRAINT: Must stay within tree's chunks
    if (!isInTreeChunks(ctx.tree, nx, nz)) continue;

    // GROUND CONSTRAINT: Only allowed at y=0 or below if attacked and chasing
    if (ny < 0 && !ctx.canGoToGround) continue;
    if (ny < -1) continue; // Never below -1 (ground level)

    // Check self-collision with numeric key
    if (_occupiedSet.has(posKey(nx, ny, nz))) continue;
    
    // Check world collision with O(1) spatial lookup
    if (isCellOccupiedByWorld(nx, ny, nz)) continue;

    // TREE CONNECTION CONSTRAINT: At least one segment must touch tree after move
    const newHeadTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);
    
    // Check body segments with loop (no slice allocation)
    let anyBodyTouchesTree = false;
    for (let i = 0; i < length - 1; i++) {
      const seg = segs[i];
      if (isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)) {
        anyBodyTouchesTree = true;
        break;
      }
    }

    // When wandering: must always stay connected to tree
    // When chasing on ground after attack: can temporarily leave tree vicinity
    if (!ctx.canGoToGround) {
      if (!newHeadTouchesTree && !anyBodyTouchesTree) continue;
    }

    // Score: Manhattan distance to target (lower = better)
    const score = Math.abs(nx - targetX) + Math.abs(ny - targetY) + Math.abs(nz - targetZ);
    scored.push({ dx, dy, dz, score });
  }

  // Fallback: try any valid move if stuck
  if (scored.length === 0) {
    for (const [dx, dy, dz] of candidates) {
      const nx = headSeg.x + dx;
      const ny = headSeg.y + dy;
      const nz = headSeg.z + dz;

      if (!isInTreeChunks(ctx.tree, nx, nz)) continue;
      if (ny < 0) continue;

      if (_occupiedSet.has(posKey(nx, ny, nz))) continue;
      if (isCellOccupiedByWorld(nx, ny, nz)) continue;

      const newHeadTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);
      let anyBodyTouchesTree = false;
      for (let i = 0; i < length - 1; i++) {
        const seg = segs[i];
        if (isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)) {
          anyBodyTouchesTree = true;
          break;
        }
      }
      if (!newHeadTouchesTree && !anyBodyTouchesTree) continue;

      scored.push({ dx, dy, dz, score: Math.random() * 100 });
    }
  }

  // BACKTRACK: If still stuck, allow head to fold back
  if (scored.length === 0 && length > 2) {
    const seg1 = segs[1];
    for (const [dx, dy, dz] of candidates) {
      const nx = headSeg.x + dx;
      const ny = headSeg.y + dy;
      const nz = headSeg.z + dz;

      if (nx !== seg1.x || ny !== seg1.y || nz !== seg1.z) continue;
      if (!isInTreeChunks(ctx.tree, nx, nz)) continue;

      // Check remaining body with loop (no slice allocation)
      let anyRemainingTouchesTree = false;
      for (let i = 2; i < length - 1; i++) {
        const seg = segs[i];
        if (isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)) {
          anyRemainingTouchesTree = true;
          break;
        }
      }
      const headTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);

      if (headTouchesTree || anyRemainingTouchesTree || length <= 3) {
        scored.push({ dx, dy, dz, score: 1000 });
        break;
      }
    }
  }

  if (scored.length === 0) {
    // Truly stuck - no movement this tick
    return;
  }

  // Sort by score and pick from top choices with some randomness
  scored.sort((a, b) => a.score - b.score);
  const topN = Math.min(3, scored.length);
  const choice = scored[Math.floor(Math.random() * topN)];

  const newHead = { x: headSeg.x + choice.dx, y: headSeg.y + choice.dy, z: headSeg.z + choice.dz };
  shnake.headDir.set(choice.dx, choice.dy, choice.dz);

  // Update collision grid: remove tail collider first
  const oldTailCollider = cols[length - 1];
  if (oldTailCollider) collisionGrid.remove(oldTailCollider);

  // Create new head collider
  const newHeadCollider = aabbForCell(newHead.x, newHead.y, newHead.z);
  collisionGrid.insert(newHeadCollider);

  // In-place segment/collider shifting (zero array allocation)
  for (let i = length - 1; i > 0; i--) {
    segs[i] = segs[i - 1];
    cols[i] = cols[i - 1];
  }
  segs[0] = newHead;
  cols[0] = newHeadCollider;

  // Notify that head moved (for fire propagation)
  ctx.onHeadMoved?.(shnake.id);
}

/**
 * Apply an attack result to a shnake - execute player damage.
 * OPTIMIZED: Pre-allocated direction vector.
 */
export function applyShnakeAttack(
  shnake: ShnakeInstance,
  result: Extract<BehaviorResult, { kind: 'attack' }>,
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void
): void {
  const now = performance.now();
  // Access ai_config from definition (use type assertion for JSONB field)
  const defAiConfig = (shnake.definition as { ai_config?: { attackCooldownMs?: number } }).ai_config;
  const cooldownMs = defAiConfig?.attackCooldownMs ?? 600;

  if (now - shnake.lastAttackAt < cooldownMs) {
    return; // Still in cooldown
  }

  shnake.lastAttackAt = now;

  if (onPlayerHit) {
    _attackDir.set(result.dirX, result.dirY, result.dirZ);
    onPlayerHit(result.damage, result.knockback, _attackDir);
  }
}

/**
 * Clear tree chunks cache (call when trees change)
 */
export function clearTreeChunksCache(): void {
  treeChunksCache.clear();
}
