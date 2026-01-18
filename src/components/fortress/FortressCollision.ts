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
  _fortressCollidersInGrid = false;
}

/**
 * Creates collision boxes for the static fortress structure
 * Cached after first call since fortress never changes
 */
export function createFortressColliders(): THREE.Box3[] {
  if (_fortressColliders) return _fortressColliders;
  
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
      }
      // else: collider already in grid from optimistic placement - reuse it
      
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
 * Checks for collision on a specific axis using spatial hash grid
 * ZERO ALLOCATIONS in hot path
 * @returns The collider that was hit, or null if no collision
 */
export function checkAxisCollision(
  pos: THREE.Vector3,
  colliders: THREE.Box3[], // kept for API compatibility, not used when grid is populated
  playerRadius: number,
  playerHeight: number,
  isHorizontal: boolean = false,
  forceCheck: boolean = false // kept for API compatibility
): THREE.Box3 | null {
  // NO THROTTLING - collision must be checked every frame for reliable physics
  diagnostics.e1++;
  
  // Use pre-allocated player box (no allocations!)
  const playerBox = createPlayerBox(pos, playerRadius, playerHeight);
  
  // Use spatial hash grid for O(1) nearby lookup - ZERO allocations
  const count = collisionGrid.getNearby(pos.x, pos.z, 3);
  const nearbyColliders = collisionGrid.nearbyResult;
  
  // Debug: Log collision grid state periodically
  if (Math.random() < 0.01) {
    console.log(`[Collision] Grid size: ${collisionGrid.size}, nearby count: ${count}, pos: (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
  }
  
  // If grid is empty, fall back to array (should not happen in normal use)
  if (count === 0 && colliders.length > 0) {
    // Fallback: check all colliders with spatial filter
    for (let i = 0; i < colliders.length; i++) {
      const collider = colliders[i];
      diagnostics.e5++;
      
      const dx = pos.x - (collider.min.x + collider.max.x) * 0.5;
      const dz = pos.z - (collider.min.z + collider.max.z) * 0.5;
      if (dx * dx + dz * dz > 4) continue; // 2 unit radius squared
      
      if (isHorizontal) {
        const standingOnBlock = (playerBox.min.y >= collider.max.y - 0.2) && (playerBox.min.y <= collider.max.y + 0.2);
        if (standingOnBlock) continue;
      }
      
      if (playerBox.intersectsBox(collider)) {
        return collider;
      }
    }
    return null;
  }
  
  // Use grid results - iterate only nearby colliders
  for (let i = 0; i < count; i++) {
    const collider = nearbyColliders[i];
    diagnostics.e5++;
    
    // For horizontal movement, skip blocks the player is standing on
    if (isHorizontal) {
      const standingOnBlock = (playerBox.min.y >= collider.max.y - 0.2) && (playerBox.min.y <= collider.max.y + 0.2);
      if (standingOnBlock) continue;
    }
    
    if (playerBox.intersectsBox(collider)) {
      return collider;
    }
  }
  return null;
}

/**
 * Finds a valid step-up target when player is blocked horizontally
 * Uses spatial hash grid for O(1) nearby lookup - ZERO allocations
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
  
  // Use spatial hash grid - ZERO allocations
  const count = collisionGrid.getNearby(camera.position.x, camera.position.z, 3);
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

// Export dimensions as an object for convenience
export const FORTRESS_DIMENSIONS = {
  cliffW,
  cliffH,
  frontT,
  courtyardDepth,
  frontZ,
  openingHalfW
};
