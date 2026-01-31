import { PlacedBlock } from '@/types/blocks';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import * as THREE from 'three';

/**
 * CANONICAL collider cache keyed by block.id.
 * This prevents collider duplication when blocks are refetched/replaced,
 * which was causing the collisionGrid to inflate with stale colliders.
 */
const colliderByBlockId = new Map<string, THREE.Box3>();

// CRITICAL: Clear the collider cache when the collision grid is cleared.
// This MUST be a module-level listener so it runs synchronously before any
// chunk loading attempts to reuse stale collider references.
// Use a flag to prevent duplicate listeners on hot reloads.
const GRID_CLEAR_LISTENER_KEY = '__chunkLoaderGridClearListener';
if (typeof window !== 'undefined' && !(window as any)[GRID_CLEAR_LISTENER_KEY]) {
  (window as any)[GRID_CLEAR_LISTENER_KEY] = true;
  window.addEventListener('collisionGridCleared', () => {
    // REMOVED: console.log spam
    colliderByBlockId.clear();
  });
}

/**
 * Update collider bounds to match block position
 */
const updateBlockColliderBounds = (block: PlacedBlock, collider: THREE.Box3): void => {
  collider.min.set(block.position_x, block.position_y, block.position_z);
  collider.max.set(block.position_x + 1, block.position_y + 1, block.position_z + 1);
};

/**
 * Create a collider for a block and insert it into the collision grid.
 * Uses canonical cache to prevent collider duplication/leaks.
 * 
 * CRITICAL FIX: Previously, when blocks were refetched and the object identity
 * changed, a new Box3 was created, but the old one stayed in collisionGrid
 * (orphaned). This caused e5 to spike even with few blocks.
 */
const ensureBlockCollider = (block: PlacedBlock): void => {
  const existing = (block as any).__collider as THREE.Box3 | null | undefined;
  let collider = colliderByBlockId.get(block.id);

  if (!collider) {
    // No cached collider for this block ID
    // CRITICAL: Only adopt existing collider if it's a valid THREE.Box3
    // After grid clear, existing colliders may be corrupted/invalid
    if (existing && typeof existing.min?.set === 'function') {
      // Adopt the block's existing collider into the cache
      collider = existing;
      colliderByBlockId.set(block.id, collider);
    } else {
      // Create a new collider (existing is null, undefined, or corrupted)
      collider = new THREE.Box3();
      colliderByBlockId.set(block.id, collider);
      // Clear the invalid reference from the block
      if (existing) {
        (block as any).__collider = null;
      }
    }
  } else if (existing && existing !== collider) {
    // Block has a different collider than cached - remove the orphan
    worldCollisionGrid.remove(existing);
  }

  // Update bounds (in case position changed, though blocks don't move)
  updateBlockColliderBounds(block, collider);

  // Ensure collider is in the grid (may have been cleared by hot reload/world switch)
  if (!worldCollisionGrid.has(collider)) {
    worldCollisionGrid.insert(collider);
  }

  (block as any).__collider = collider;
};

/**
 * Remove a block's collider from the collision grid and cache.
 */
const removeBlockCollider = (block: PlacedBlock): void => {
  const cached = colliderByBlockId.get(block.id);
  const collider = cached ?? ((block as any).__collider as THREE.Box3 | null | undefined);

  if (collider) {
    worldCollisionGrid.remove(collider);
  }

  colliderByBlockId.delete(block.id);
  (block as any).__collider = null;
};

export { ensureBlockCollider, removeBlockCollider };
