import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { collisionGrid } from '@/lib/spatialHashGrid';

// ============================================================
// FORTRESS COLLISION UTILITIES
// ============================================================

// Fortress dimensions constants
export const cliffW = 40;
export const cliffH = 20;
export const frontT = 2;
export const courtyardDepth = 30;
export const frontZ = -8;
export const openingHalfW = 2;

// Pre-allocated reusable objects to prevent GC pressure
// These are module-level singletons - safe because collision is single-threaded
const _playerBoxMin = new THREE.Vector3();
const _playerBoxMax = new THREE.Vector3();
const _reusablePlayerBox = new THREE.Box3();
const _stepUpMin = new THREE.Vector3();
const _stepUpMax = new THREE.Vector3();
const _clearanceMin = new THREE.Vector3();
const _clearanceMax = new THREE.Vector3();

// Cached fortress colliders (never change)
let _fortressColliders: THREE.Box3[] | null = null;
let _fortressCollidersInGrid = false;

// Function to reset grid state when grid is cleared externally
export function resetFortressGridState(): void {
  // Mark as not in grid, then immediately re-insert if we already have the cached colliders.
  // This is important because the collider list is cached across HMR/runtime, but the grid may be cleared.
  _fortressCollidersInGrid = false;

  if (_fortressColliders) {
    for (const fc of _fortressColliders) {
      if (!collisionGrid.has(fc)) {
        collisionGrid.insert(fc);
      }
    }
    _fortressCollidersInGrid = true;
  }
}

/**
 * Creates collision boxes for the static fortress structure
 * Cached after first call since fortress never changes
 */
export function createFortressColliders(): THREE.Box3[] {
  // If colliders are cached, we still must ensure they are present in the grid.
  // The grid can be cleared independently (debug key, hot reload, world reset).
  if (_fortressColliders) {
    if (!_fortressCollidersInGrid) {
      for (const fc of _fortressColliders) {
        if (!collisionGrid.has(fc)) {
          collisionGrid.insert(fc);
        }
      }
      _fortressCollidersInGrid = true;
    }
    return _fortressColliders;
  }
  
  _fortressColliders = [
    // Left pillar
    new THREE.Box3(
      new THREE.Vector3(-cliffW/2, 0, frontZ - frontT/2),
      new THREE.Vector3(-cliffW/4 - openingHalfW/2 + (cliffW/2 - openingHalfW)/2, cliffH, frontZ + frontT/2)
    ),
    // Right pillar  
    new THREE.Box3(
      new THREE.Vector3(cliffW/4 + openingHalfW/2 - (cliffW/2 - openingHalfW)/2, 0, frontZ - frontT/2),
      new THREE.Vector3(cliffW/2, cliffH, frontZ + frontT/2)
    ),
    // Side walls
    new THREE.Box3(
      new THREE.Vector3(-cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
      new THREE.Vector3(-cliffW/2 + 1, cliffH, frontZ - frontT)
    ),
    new THREE.Box3(
      new THREE.Vector3(cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
      new THREE.Vector3(cliffW/2 + 1, cliffH, frontZ - frontT)
    ),
    // Back wall
    new THREE.Box3(
      new THREE.Vector3(-cliffW/2, 0, frontZ - courtyardDepth - frontT - 1),
      new THREE.Vector3(cliffW/2, cliffH, frontZ - courtyardDepth - frontT + 1)
    )
  ];
  
  // Add fortress colliders to spatial grid once
  if (!_fortressCollidersInGrid) {
    for (const fc of _fortressColliders) {
      collisionGrid.insert(fc);
    }
    _fortressCollidersInGrid = true;
  }
  
  return _fortressColliders;
}

// Reusable array for createBlockColliders - avoids allocation on every call
const _cachedCollidersArray: THREE.Box3[] = [];

/**
 * Creates and manages collision boxes for placed blocks with caching
 * Also maintains spatial hash grid for O(1) lookups
 * OPTIMIZED: Only allocates when blocks actually change
 */
export function createBlockColliders(
  blocks: PlacedBlock[],
  cache: Map<string, THREE.Box3>
): THREE.Box3[] {
  // Quick check: if cache size matches blocks length and all blocks are cached, no work needed
  if (cache.size === blocks.length) {
    let allCached = true;
    for (let i = 0; i < blocks.length; i++) {
      if (!cache.has(blocks[i].id)) {
        allCached = false;
        break;
      }
    }
    if (allCached) {
      // No changes - return cached array without allocation
      _cachedCollidersArray.length = 0;
      for (const box of cache.values()) {
        _cachedCollidersArray.push(box);
      }
      return _cachedCollidersArray;
    }
  }
  
  // Track allocation for diagnostics - only count when we actually do work
  diagnostics.e4++;
  
  // STEP 1: Add new blocks to cache
  for (const block of blocks) {
    if (!cache.has(block.id)) {
      // Check if collider was pre-registered during optimistic placement
      // This prevents duplicate colliders and ensures instant collision
      let box = (block as any).__collider as THREE.Box3 | undefined;
      
      if (!box) {
        // No pre-registered collider, create one
        box = new THREE.Box3(
          new THREE.Vector3(block.position_x, block.position_y, block.position_z),
          new THREE.Vector3(block.position_x + 1, block.position_y + 1, block.position_z + 1)
        );
        collisionGrid.insert(box);
        // Store collider reference on block for future cache hits
        (block as any).__collider = box;
      } else {
        // Verify the pre-registered collider is actually in the grid
        // If not (e.g. grid was cleared), re-insert it
        if (!collisionGrid.has(box)) {
          collisionGrid.insert(box);
        }
      }
      
      cache.set(block.id, box);
    }
  }
  
  // STEP 2: Remove stale blocks - only if cache is larger than blocks array
  if (cache.size > blocks.length) {
    // Build lookup without Set - use simple O(n) search since this is rare
    const keysToRemove: string[] = [];
    for (const id of cache.keys()) {
      let found = false;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].id === id) {
          found = true;
          break;
        }
      }
      if (!found) {
        keysToRemove.push(id);
      }
    }
    for (const id of keysToRemove) {
      const box = cache.get(id);
      if (box) collisionGrid.remove(box);
      cache.delete(id);
    }
  }
  
  // Return reused array
  _cachedCollidersArray.length = 0;
  for (const box of cache.values()) {
    _cachedCollidersArray.push(box);
  }
  return _cachedCollidersArray;
}

/**
 * Creates a player bounding box at a given position - REUSES pre-allocated box
 * WARNING: Returns a shared object - do not store the result!
 */
export function createPlayerBox(
  pos: THREE.Vector3,
  playerRadius: number,
  playerHeight: number
): THREE.Box3 {
  _playerBoxMin.set(pos.x - playerRadius, pos.y - playerHeight, pos.z - playerRadius);
  _playerBoxMax.set(pos.x + playerRadius, pos.y, pos.z + playerRadius);
  _reusablePlayerBox.set(_playerBoxMin, _playerBoxMax);
  return _reusablePlayerBox;
}

/**
 * Collision axis type for Minecraft-style AABB resolution
 * - 'overlap': check for pure strict overlap (no axis preference)
 * - 'x', 'y', 'z': check collision along that movement axis
 */
export type CollisionAxis = 'x' | 'y' | 'z' | 'overlap';

// Epsilon values for collision tests
const ORTHO_EPS = 1e-6;  // Orthogonal axes: strict overlap (touching does NOT count)
const AXIS_EPS = 1e-6;   // Movement axis: inclusive overlap (touching counts)

/**
 * Strict overlap: returns true only if ranges genuinely overlap (not just touching)
 * Used for axes orthogonal to movement direction
 */
const overlapsStrict = (aMin: number, aMax: number, bMin: number, bMax: number, eps = ORTHO_EPS): boolean =>
  aMax > bMin + eps && aMin < bMax - eps;

/**
 * Inclusive overlap: returns true if ranges overlap OR just touch
 * Used for the movement axis to prevent tunneling
 */
const overlapsInclusive = (aMin: number, aMax: number, bMin: number, bMax: number, eps = AXIS_EPS): boolean =>
  aMax >= bMin - eps && aMin <= bMax + eps;

/**
 * Axis-aware intersection test for Minecraft-style AABB collision
 * 
 * KEY FIX: Previously used Box3.intersectsBox() which returns true for touching faces.
 * This caused standing on a block to trigger horizontal collision, and side blocks
 * to be detected as ceiling/floor during Y movement.
 * 
 * Correct behavior:
 * - Movement axis: inclusive overlap (touching counts as collision)
 * - Orthogonal axes: strict overlap (touching does NOT count)
 */
const intersectsForAxis = (playerBox: THREE.Box3, collider: THREE.Box3, axis: CollisionAxis): boolean => {
  const p = playerBox;
  const c = collider;

  switch (axis) {
    case 'overlap':
      // Pure overlap check - all axes strict
      return overlapsStrict(p.min.x, p.max.x, c.min.x, c.max.x) &&
             overlapsStrict(p.min.y, p.max.y, c.min.y, c.max.y) &&
             overlapsStrict(p.min.z, p.max.z, c.min.z, c.max.z);

    case 'x':
      // X-axis movement: X inclusive, Y/Z strict
      return overlapsInclusive(p.min.x, p.max.x, c.min.x, c.max.x) &&
             overlapsStrict(p.min.y, p.max.y, c.min.y, c.max.y) &&
             overlapsStrict(p.min.z, p.max.z, c.min.z, c.max.z);

    case 'y':
      // Y-axis movement: Y inclusive, X/Z strict
      return overlapsStrict(p.min.x, p.max.x, c.min.x, c.max.x) &&
             overlapsInclusive(p.min.y, p.max.y, c.min.y, c.max.y) &&
             overlapsStrict(p.min.z, p.max.z, c.min.z, c.max.z);

    case 'z':
      // Z-axis movement: Z inclusive, X/Y strict
      return overlapsStrict(p.min.x, p.max.x, c.min.x, c.max.x) &&
             overlapsStrict(p.min.y, p.max.y, c.min.y, c.max.y) &&
             overlapsInclusive(p.min.z, p.max.z, c.min.z, c.max.z);
  }
};

/**
 * Checks for collision on a specific axis using spatial hash grid
 * ZERO ALLOCATIONS in hot path
 * Uses Y-filtered query for Minecraft-style collision
 * 
 * @param axis - Which axis to check collision for ('x', 'y', 'z', 'overlap')
 * @param direction - For Y-axis: 1 = moving up (find ceiling), -1 = moving down (find floor)
 * @returns The collider that was hit, or null if no collision
 */
export function checkAxisCollision(
  pos: THREE.Vector3,
  colliders: THREE.Box3[], // kept for API compatibility, not used when grid is populated
  playerRadius: number,
  playerHeight: number,
  axis: CollisionAxis = 'overlap',
  direction: 1 | -1 = -1 // only used for Y-axis
): THREE.Box3 | null {
  diagnostics.e1++;
  
  const playerBox = createPlayerBox(pos, playerRadius, playerHeight);
  
  // Query only colliders near the player's vertical span (+ margin)
  const minY = playerBox.min.y - 0.5;
  const maxY = playerBox.max.y + 0.5;
  
  const count = collisionGrid.getNearbyFiltered(pos.x, pos.z, 1.5, minY, maxY);
  const nearbyColliders = collisionGrid.nearbyResult;
  
  // Fallback: if grid is empty but we have colliders passed in
  if (count === 0 && colliders.length > 0 && collisionGrid.size === 0) {
    for (let i = 0; i < colliders.length; i++) {
      const collider = colliders[i];
      diagnostics.e5++;
      
      const dx = pos.x - (collider.min.x + collider.max.x) * 0.5;
      const dz = pos.z - (collider.min.z + collider.max.z) * 0.5;
      if (dx * dx + dz * dz > 4) continue;
      
      if (intersectsForAxis(playerBox, collider, axis)) {
        return collider;
      }
    }
    return null;
  }
  
  // For Y-axis, we need to find the correct ceiling/floor based on direction
  let bestCollider: THREE.Box3 | null = null;
  let bestY = direction > 0 ? Infinity : -Infinity; // ceiling = lowest min.y, floor = highest max.y
  
  for (let i = 0; i < count; i++) {
    const collider = nearbyColliders[i];
    diagnostics.e5++;
    
    if (intersectsForAxis(playerBox, collider, axis)) {
      if (axis === 'y') {
        // Directional Y selection: find correct ceiling or floor
        if (direction > 0) {
          // Moving up - find lowest ceiling (smallest min.y that's above player head)
          if (collider.min.y < bestY) {
            bestY = collider.min.y;
            bestCollider = collider;
          }
        } else {
          // Moving down - find highest floor (largest max.y that's below player feet)
          if (collider.max.y > bestY) {
            bestY = collider.max.y;
            bestCollider = collider;
          }
        }
      } else {
        // For X/Z/overlap, return first hit
        return collider;
      }
    }
  }
  
  return bestCollider;
}

/**
 * Finds a valid step-up target when player is blocked horizontally
 * Uses Y-filtered spatial hash grid for Minecraft-style collision
 * @returns The Y coordinate to step up to, or null if no valid target
 */
export function findStepUpTarget(
  camera: THREE.Camera,
  colliders: THREE.Box3[], // kept for API compatibility
  playerRadius: number,
  playerHeight: number,
  stepUpHeight: number = 0.6,
  playerBoxRef: THREE.Box3,
  clearanceBoxRef: THREE.Box3,
  forceCheck: boolean = false // kept for API compatibility
): number | null {
  // NO THROTTLING - step-up must be checked every frame for reliable physics
  diagnostics.e2++;
  
  const currentFootY = camera.position.y - playerHeight;
  let bestStepUpY: number | null = null;
  
  // Step-up only cares about colliders near feet up through head clearance
  const minY = currentFootY - 0.5;
  const maxY = currentFootY + stepUpHeight + playerHeight + 0.5;
  
  // Use Y-filtered spatial hash grid - radius 1.5 is sufficient
  const count = collisionGrid.getNearbyFiltered(camera.position.x, camera.position.z, 1.5, minY, maxY);
  const nearbyColliders = collisionGrid.nearbyResult;
  
  for (let i = 0; i < count; i++) {
    const collider = nearbyColliders[i];
    const blockTopY = collider.max.y;
    
    // Block top must be above our feet but within step-up range
    if (blockTopY > currentFootY && blockTopY <= currentFootY + stepUpHeight) {
      // Check horizontal overlap - reuse pre-allocated vectors
      _stepUpMin.set(
        camera.position.x - playerRadius,
        blockTopY,
        camera.position.z - playerRadius
      );
      _stepUpMax.set(
        camera.position.x + playerRadius,
        blockTopY + playerHeight,
        camera.position.z + playerRadius
      );
      playerBoxRef.set(_stepUpMin, _stepUpMax);
      
      const horizontalOverlap = !(
        playerBoxRef.max.x <= collider.min.x ||
        playerBoxRef.min.x >= collider.max.x ||
        playerBoxRef.max.z <= collider.min.z ||
        playerBoxRef.min.z >= collider.max.z
      );
      
      if (horizontalOverlap) {
        // Check clearance - reuse pre-allocated vectors
        _clearanceMin.set(
          camera.position.x - playerRadius,
          blockTopY,
          camera.position.z - playerRadius
        );
        _clearanceMax.set(
          camera.position.x + playerRadius,
          blockTopY + playerHeight,
          camera.position.z + playerRadius
        );
        clearanceBoxRef.set(_clearanceMin, _clearanceMax);
        
        let hasClearance = true;
        // Only check nearby colliders for clearance
        for (let j = 0; j < count; j++) {
          const otherCollider = nearbyColliders[j];
          if (otherCollider === collider) continue;
          if (otherCollider.min.y > blockTopY + playerHeight) continue;
          if (otherCollider.max.y < blockTopY) continue;
          
          if (clearanceBoxRef.intersectsBox(otherCollider)) {
            hasClearance = false;
            break;
          }
        }
        
        if (hasClearance) {
          if (bestStepUpY === null || blockTopY < bestStepUpY) {
            bestStepUpY = blockTopY;
          }
        }
      }
    }
  }
  
  return bestStepUpY;
}

/**
 * Find the best direction to push the player out of a block
 * Returns the axis and direction to push, biased toward pushing UP
 */
export function findPushOutDirection(
  playerPos: THREE.Vector3,
  playerRadius: number,
  playerHeight: number,
  block: THREE.Box3
): { axis: 'x' | 'y' | 'z'; direction: 1 | -1; distance: number } | null {
  // Player AABB (playerPos.y is TOP of player in this codebase)
  const pMinX = playerPos.x - playerRadius;
  const pMaxX = playerPos.x + playerRadius;
  const pMinY = playerPos.y - playerHeight;
  const pMaxY = playerPos.y;
  const pMinZ = playerPos.z - playerRadius;
  const pMaxZ = playerPos.z + playerRadius;

  // Safety: only compute push if actually intersecting
  const intersects =
    pMaxX > block.min.x && pMinX < block.max.x &&
    pMaxY > block.min.y && pMinY < block.max.y &&
    pMaxZ > block.min.z && pMinZ < block.max.z;

  if (!intersects) return null;

  // Distances to move player so they no longer intersect (distance-to-face)
  const distNegX = pMaxX - block.min.x; // move left
  const distPosX = block.max.x - pMinX; // move right
  const distNegY = pMaxY - block.min.y; // move down
  const distPosY = block.max.y - pMinY; // move up
  const distNegZ = pMaxZ - block.min.z; // move back
  const distPosZ = block.max.z - pMinZ; // move forward

  type Candidate = { axis: 'x' | 'y' | 'z'; direction: 1 | -1; distance: number; score: number };
  const candidates: Candidate[] = [];

  if (distNegX > 0) candidates.push({ axis: 'x', direction: -1, distance: distNegX, score: distNegX });
  if (distPosX > 0) candidates.push({ axis: 'x', direction:  1, distance: distPosX, score: distPosX });
  if (distNegZ > 0) candidates.push({ axis: 'z', direction: -1, distance: distNegZ, score: distNegZ });
  if (distPosZ > 0) candidates.push({ axis: 'z', direction:  1, distance: distPosZ, score: distPosZ });

  // Bias: prefer pushing UP (0.95 multiplier), strongly avoid DOWN (1.50 penalty)
  if (distPosY > 0) candidates.push({ axis: 'y', direction:  1, distance: distPosY, score: distPosY * 0.95 });
  if (distNegY > 0) candidates.push({ axis: 'y', direction: -1, distance: distNegY, score: distNegY * 1.50 });

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].score < best.score) best = candidates[i];
  }

  return { axis: best.axis, direction: best.direction, distance: best.distance };
}

// Export dimensions as an object for convenience
export const FORTRESS_DIMENSIONS = {
  cliffW,
  cliffH,
  frontT,
  courtyardDepth,
  frontZ,
  openingHalfW
};
