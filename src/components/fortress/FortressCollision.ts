import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { diagnostics } from '@/lib/diagnosticsLogger';

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
  
  return _fortressColliders;
}

/**
 * Creates and manages collision boxes for placed blocks with caching
 * Uses incremental updates to avoid full rebuilds
 */
export function createBlockColliders(
  blocks: PlacedBlock[],
  cache: Map<string, THREE.Box3>
): THREE.Box3[] {
  // Track allocation for diagnostics
  diagnostics.e4++;
  
  const currentBlockIds = new Set(blocks.map(b => b.id));
  
  // Remove collision boxes for deleted blocks
  for (const id of cache.keys()) {
    if (!currentBlockIds.has(id)) {
      cache.delete(id);
    }
  }
  
  // Add collision boxes for new blocks only
  for (const block of blocks) {
    if (!cache.has(block.id)) {
      const box = new THREE.Box3(
        new THREE.Vector3(block.position_x, block.position_y, block.position_z),
        new THREE.Vector3(block.position_x + 1, block.position_y + 1, block.position_z + 1)
      );
      cache.set(block.id, box);
    }
  }
  
  return Array.from(cache.values());
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
 * Checks for collision on a specific axis with spatial filtering
 * @returns The collider that was hit, or null if no collision
 */
export function checkAxisCollision(
  pos: THREE.Vector3,
  colliders: THREE.Box3[],
  playerRadius: number,
  playerHeight: number,
  isHorizontal: boolean = false
): THREE.Box3 | null {
  diagnostics.e1++;
  
  // Use pre-allocated player box (no allocations!)
  const playerBox = createPlayerBox(pos, playerRadius, playerHeight);
  
  // Spatial filter: only check colliders within 2 units (avoids O(n) on distant blocks)
  const checkRadius = 2.0;
  
  for (let i = 0; i < colliders.length; i++) {
    const collider = colliders[i];
    diagnostics.e5++; // Track inner loop iterations
    
    // Quick spatial reject - skip colliders too far away
    const dx = pos.x - (collider.min.x + collider.max.x) * 0.5;
    const dz = pos.z - (collider.min.z + collider.max.z) * 0.5;
    if (dx * dx + dz * dz > checkRadius * checkRadius + 1) continue;
    
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
 * @returns The Y coordinate to step up to, or null if no valid target
 */
export function findStepUpTarget(
  camera: THREE.Camera,
  colliders: THREE.Box3[],
  playerRadius: number,
  playerHeight: number,
  stepUpHeight: number = 0.6,
  playerBoxRef: THREE.Box3,
  clearanceBoxRef: THREE.Box3
): number | null {
  diagnostics.e2++;
  
  const currentFootY = camera.position.y - playerHeight;
  let bestStepUpY: number | null = null;
  const checkRadius = 2.0;
  
  for (let i = 0; i < colliders.length; i++) {
    const collider = colliders[i];
    
    // Quick spatial reject
    const dx = camera.position.x - (collider.min.x + collider.max.x) * 0.5;
    const dz = camera.position.z - (collider.min.z + collider.max.z) * 0.5;
    if (dx * dx + dz * dz > checkRadius * checkRadius + 1) continue;
    
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
        // Check all colliders for clearance (with spatial filter)
        for (let j = 0; j < colliders.length; j++) {
          const otherCollider = colliders[j];
          if (otherCollider === collider) continue;
          
          // Spatial filter for clearance check too
          const odx = camera.position.x - (otherCollider.min.x + otherCollider.max.x) * 0.5;
          const odz = camera.position.z - (otherCollider.min.z + otherCollider.max.z) * 0.5;
          if (odx * odx + odz * odz > checkRadius * checkRadius + 1) continue;
          
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
