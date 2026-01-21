/**
 * ShnakeLocomotion - Movement execution for Shnakes
 * 
 * Phase 4: Extracted from useShnakeMovement to be called by ShnakeAdapter.applyResult
 * Contains the core movement logic without React hook dependencies.
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

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

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

export interface ShnakeLocomotionContext {
  tree: PlantedTree;
  treeBlocksByTier: Map<number, Map<string, string>> | null;
  worldBlocks: { position_x: number; position_y: number; position_z: number }[];
  canGoToGround: boolean;
  onHeadMoved?: (shnakeId: string) => void;
}

/**
 * Check if position is adjacent to any tree block of this tier.
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

  const neighbors = [
    key(x + 1, y, z), key(x - 1, y, z),
    key(x, y + 1, z), key(x, y - 1, z),
    key(x, y, z + 1), key(x, y, z - 1),
  ];

  for (const nk of neighbors) {
    if (tierMap.has(nk)) return true;
  }
  return false;
}

/**
 * Check if position is within tree's chunk bounds
 */
function isInTreeChunks(tree: PlantedTree, x: number, z: number): boolean {
  const treeChunks = getTreeChunkKeys(tree);
  const ck = chunkKey(x, z);
  return treeChunks.has(ck);
}

/**
 * Check if world position is occupied by a placed block
 */
function isWorldOccupied(
  x: number,
  y: number,
  z: number,
  blocks: { position_x: number; position_y: number; position_z: number }[]
): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.position_x === x && b.position_y === y && b.position_z === z) return true;
  }
  return false;
}

/**
 * Apply a move result to a shnake - core movement execution.
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
  const headSeg = shnake.segments[0];
  const length = shnake.segments.length;
  const tail = shnake.segments[length - 1];
  const occupied = new Set<string>(shnake.segments.map(seg => key(seg.x, seg.y, seg.z)));

  // Allow moving into current tail cell because it vacates this step
  occupied.delete(key(tail.x, tail.y, tail.z));

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

    const k = key(nx, ny, nz);
    if (occupied.has(k)) continue;
    if (isWorldOccupied(nx, ny, nz, ctx.worldBlocks)) continue;

    // TREE CONNECTION CONSTRAINT: At least one segment must touch tree after move
    const newHeadTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);
    const anyBodyTouchesTree = shnake.segments.slice(0, -1).some(
      seg => isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)
    );

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

      const k = key(nx, ny, nz);
      if (occupied.has(k)) continue;
      if (isWorldOccupied(nx, ny, nz, ctx.worldBlocks)) continue;

      const newHeadTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);
      const anyBodyTouchesTree = shnake.segments.slice(0, -1).some(
        seg => isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)
      );
      if (!newHeadTouchesTree && !anyBodyTouchesTree) continue;

      scored.push({ dx, dy, dz, score: Math.random() * 100 });
    }
  }

  // BACKTRACK: If still stuck, allow head to fold back
  if (scored.length === 0 && shnake.segments.length > 2) {
    const seg1 = shnake.segments[1];
    for (const [dx, dy, dz] of candidates) {
      const nx = headSeg.x + dx;
      const ny = headSeg.y + dy;
      const nz = headSeg.z + dz;

      if (nx !== seg1.x || ny !== seg1.y || nz !== seg1.z) continue;
      if (!isInTreeChunks(ctx.tree, nx, nz)) continue;

      const remainingBody = shnake.segments.slice(2, -1);
      const anyRemainingTouchesTree = remainingBody.some(
        seg => isTouchingTree(shnake.tier, seg.x, seg.y, seg.z, ctx.treeBlocksByTier)
      );
      const headTouchesTree = isTouchingTree(shnake.tier, nx, ny, nz, ctx.treeBlocksByTier);

      if (headTouchesTree || anyRemainingTouchesTree || remainingBody.length === 0) {
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

  // Update collision grid: remove tail collider, insert new head collider
  const oldTailCollider = shnake.colliders[shnake.colliders.length - 1];
  if (oldTailCollider) collisionGrid.remove(oldTailCollider);
  const newHeadCollider = aabbForCell(newHead.x, newHead.y, newHead.z);
  collisionGrid.insert(newHeadCollider);

  // Shift arrays (worm movement)
  const newSegments = [newHead, ...shnake.segments.slice(0, -1)];
  const newColliders = [newHeadCollider, ...shnake.colliders.slice(0, -1)];
  shnake.segments = newSegments;
  shnake.colliders = newColliders;

  // Notify that head moved (for fire propagation)
  ctx.onHeadMoved?.(shnake.id);
}

/**
 * Apply an attack result to a shnake - execute player damage.
 */
export function applyShnakeAttack(
  shnake: ShnakeInstance,
  result: Extract<BehaviorResult, { kind: 'attack' }>,
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void
): void {
  const now = performance.now();
  // Access ai_config from definition (type includes it but LSP may lag)
  const defAiConfig = (shnake.definition as any).ai_config;
  const cooldownMs = defAiConfig?.attackCooldownMs ?? 600;

  if (now - shnake.lastAttackAt < cooldownMs) {
    return; // Still in cooldown
  }

  shnake.lastAttackAt = now;

  if (onPlayerHit) {
    const dir = new THREE.Vector3(result.dirX, result.dirY, result.dirZ);
    onPlayerHit(result.damage, result.knockback, dir);
  }
}
