import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';

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

/**
 * Creates collision boxes for the static fortress structure
 */
export function createFortressColliders(): THREE.Box3[] {
  return [
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
}

/**
 * Creates and manages collision boxes for placed blocks with caching
 */
export function createBlockColliders(
  blocks: PlacedBlock[],
  cache: Map<string, THREE.Box3>
): THREE.Box3[] {
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
      cache.set(block.id, new THREE.Box3(
        new THREE.Vector3(block.position_x, block.position_y, block.position_z),
        new THREE.Vector3(block.position_x + 1, block.position_y + 1, block.position_z + 1)
      ));
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
 * Checks for collision on a specific axis
 * @returns The collider that was hit, or null if no collision
 */
export function checkAxisCollision(
  pos: THREE.Vector3,
  colliders: THREE.Box3[],
  playerRadius: number,
  playerHeight: number,
  isHorizontal: boolean = false
): THREE.Box3 | null {
  // Use pre-allocated player box (no allocations!)
  const playerBox = createPlayerBox(pos, playerRadius, playerHeight);
  const spatialRadius = 2.0;
  
  for (const collider of colliders) {
    // Spatial filtering - skip blocks too far away
    const colliderCenterX = (collider.max.x + collider.min.x) / 2;
    const colliderCenterZ = (collider.max.z + collider.min.z) / 2;
    const distX = Math.abs(colliderCenterX - pos.x);
    const distZ = Math.abs(colliderCenterZ - pos.z);
    if (Math.sqrt(distX * distX + distZ * distZ) > spatialRadius) continue;
    
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
  const currentFootY = camera.position.y - playerHeight;
  const spatialRadius = 2.0;
  let bestStepUpY: number | null = null;
  
  for (const collider of colliders) {
    // Spatial filtering
    const distX = Math.abs(collider.max.x + collider.min.x) / 2 - camera.position.x;
    const distZ = Math.abs(collider.max.z + collider.min.z) / 2 - camera.position.z;
    if (Math.sqrt(distX * distX + distZ * distZ) > spatialRadius) continue;
    
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
        for (const otherCollider of colliders) {
          if (otherCollider === collider) continue;
          if (otherCollider.min.y > blockTopY + playerHeight) continue;
          if (otherCollider.max.y < blockTopY) continue;
          
          const otherDistX = Math.abs(otherCollider.max.x + otherCollider.min.x) / 2 - camera.position.x;
          const otherDistZ = Math.abs(otherCollider.max.z + otherCollider.min.z) / 2 - camera.position.z;
          if (Math.sqrt(otherDistX * otherDistX + otherDistZ * otherDistZ) > spatialRadius) continue;
          
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
