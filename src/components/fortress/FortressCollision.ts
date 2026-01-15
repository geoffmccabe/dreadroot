import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { DEBUG_LOGGING } from './FortressTypes';

// Fortress wall dimensions (shared constants)
export const FORTRESS_DIMENSIONS = {
  cliffW: 40,
  cliffH: 20,
  frontT: 2,
  courtyardDepth: 30,
  frontZ: -8,
  openingHalfW: 2
};

// Create fortress wall colliders (static)
export function createFortressColliders(): THREE.Box3[] {
  const { cliffW, cliffH, frontT, courtyardDepth, frontZ, openingHalfW } = FORTRESS_DIMENSIONS;

  return [
    // Left pillar
    new THREE.Box3(
      new THREE.Vector3(-cliffW / 2, 0, frontZ - frontT / 2),
      new THREE.Vector3(-cliffW / 4 - openingHalfW / 2 + (cliffW / 2 - openingHalfW) / 2, cliffH, frontZ + frontT / 2)
    ),
    // Right pillar
    new THREE.Box3(
      new THREE.Vector3(cliffW / 4 + openingHalfW / 2 - (cliffW / 2 - openingHalfW) / 2, 0, frontZ - frontT / 2),
      new THREE.Vector3(cliffW / 2, cliffH, frontZ + frontT / 2)
    ),
    // Left side wall
    new THREE.Box3(
      new THREE.Vector3(-cliffW / 2 - 1, 0, frontZ - courtyardDepth - frontT),
      new THREE.Vector3(-cliffW / 2 + 1, cliffH, frontZ - frontT)
    ),
    // Right side wall
    new THREE.Box3(
      new THREE.Vector3(cliffW / 2 - 1, 0, frontZ - courtyardDepth - frontT),
      new THREE.Vector3(cliffW / 2 + 1, cliffH, frontZ - frontT)
    ),
    // Back wall
    new THREE.Box3(
      new THREE.Vector3(-cliffW / 2, 0, frontZ - courtyardDepth - frontT - 1),
      new THREE.Vector3(cliffW / 2, cliffH, frontZ - courtyardDepth - frontT + 1)
    )
  ];
}

// Create block colliders from placed blocks
export function createBlockColliders(
  blocks: PlacedBlock[],
  cache: Map<string, THREE.Box3>
): THREE.Box3[] {
  const currentBlockIds = new Set(blocks.map(b => b.id));

  // Remove deleted blocks from cache
  for (const id of cache.keys()) {
    if (!currentBlockIds.has(id)) {
      cache.delete(id);
    }
  }

  // Add new blocks to cache
  for (const block of blocks) {
    if (!cache.has(block.id)) {
      const pos = new THREE.Vector3(block.position_x, block.position_y, block.position_z);
      cache.set(block.id, new THREE.Box3(
        new THREE.Vector3(pos.x - 0.5, pos.y - 0.5, pos.z - 0.5),
        new THREE.Vector3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5)
      ));
    }
  }

  return Array.from(cache.values());
}

// Helper function to create player bounding box
export function createPlayerBox(
  pos: THREE.Vector3,
  playerRadius: number,
  playerHeight: number
): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(pos.x - playerRadius, pos.y - playerHeight, pos.z - playerRadius),
    new THREE.Vector3(pos.x + playerRadius, pos.y, pos.z + playerRadius)
  );
}

// Check collision on a specific axis
export function checkAxisCollision(
  pos: THREE.Vector3,
  colliders: THREE.Box3[],
  playerRadius: number,
  playerHeight: number,
  isHorizontal: boolean = false
): THREE.Box3 | null {
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
      const standingOnBlock = 
        playerBox.min.y >= collider.max.y - 0.2 && 
        playerBox.min.y <= collider.max.y + 0.2;
      if (standingOnBlock) {
        if (DEBUG_LOGGING && Math.random() < 0.01) {
          console.log('[Standing Check]', {
            playerMinY: playerBox.min.y,
            colliderMaxY: collider.max.y,
            diff: Math.abs(playerBox.min.y - collider.max.y),
            skipping: true
          });
        }
        continue;
      }
    }

    if (playerBox.intersectsBox(collider)) {
      return collider;
    }
  }

  return null;
}

// Step-up mechanic - find valid step-up target
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

    // Block top must be above feet but within step-up range
    if (blockTopY > currentFootY && blockTopY <= currentFootY + stepUpHeight) {
      // Check horizontal overlap
      playerBoxRef.set(
        new THREE.Vector3(
          camera.position.x - playerRadius,
          blockTopY,
          camera.position.z - playerRadius
        ),
        new THREE.Vector3(
          camera.position.x + playerRadius,
          blockTopY + playerHeight,
          camera.position.z + playerRadius
        )
      );

      const horizontalOverlap = !(
        playerBoxRef.max.x <= collider.min.x ||
        playerBoxRef.min.x >= collider.max.x ||
        playerBoxRef.max.z <= collider.min.z ||
        playerBoxRef.min.z >= collider.max.z
      );

      if (horizontalOverlap) {
        // Check clearance above step target
        clearanceBoxRef.set(
          new THREE.Vector3(
            camera.position.x - playerRadius,
            blockTopY,
            camera.position.z - playerRadius
          ),
          new THREE.Vector3(
            camera.position.x + playerRadius,
            blockTopY + playerHeight,
            camera.position.z + playerRadius
          )
        );

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
