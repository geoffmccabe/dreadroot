/**
 * Line of Sight sensing - wraps existing voxelRaycast
 * 
 * Zero-allocation implementation using pre-allocated vectors.
 */

import * as THREE from 'three';
import { voxelRaycast } from '@/lib/voxelRaycast';
import type { PlacedBlock } from '@/types/blocks';

// Pre-allocated vectors for ray origin and direction
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();

/**
 * Check if there's line of sight between enemy and player.
 * Uses existing voxelRaycast with its internal caching.
 * 
 * @param ex Enemy X position
 * @param ey Enemy Y position (use head height)
 * @param ez Enemy Z position
 * @param px Player X position
 * @param py Player Y position
 * @param pz Player Z position
 * @param blocks Array of placed blocks for collision
 * @returns true if clear line of sight, false if blocked
 */
export function hasLineOfSight(
  ex: number,
  ey: number,
  ez: number,
  px: number,
  py: number,
  pz: number,
  blocks: PlacedBlock[]
): boolean {
  // Calculate distance
  const dx = px - ex;
  const dy = py - ey;
  const dz = pz - ez;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  // If very close, assume LOS
  if (dist < 1) return true;
  
  // Set up ray
  _origin.set(ex, ey, ez);
  _direction.set(dx / dist, dy / dist, dz / dist);
  
  // Cast ray toward player
  const hit = voxelRaycast(_origin, _direction, dist, blocks);
  
  // If no hit, clear LOS
  if (!hit) return true;
  
  // If hit is further than player distance, clear LOS
  if (hit.distance >= dist - 0.5) return true;
  
  // Hit something before reaching player - blocked
  return false;
}

/**
 * Check if enemy can see a specific point (for pathfinding/targeting).
 */
export function canSeePoint(
  ex: number,
  ey: number,
  ez: number,
  tx: number,
  ty: number,
  tz: number,
  blocks: PlacedBlock[],
  maxDist: number = 64
): boolean {
  const dx = tx - ex;
  const dy = ty - ey;
  const dz = tz - ez;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  if (dist > maxDist) return false;
  if (dist < 0.5) return true;
  
  _origin.set(ex, ey, ez);
  _direction.set(dx / dist, dy / dist, dz / dist);
  
  const hit = voxelRaycast(_origin, _direction, dist, blocks);
  
  return !hit || hit.distance >= dist - 0.5;
}
