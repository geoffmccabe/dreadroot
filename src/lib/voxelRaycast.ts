import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { FORTRESS_DIMENSIONS } from '@/components/fortress/FortressCollision';

/**
 * Amanatides-Woo Voxel Traversal Algorithm
 * 
 * ZERO ALLOCATIONS - All objects are pre-allocated and reused
 * O(ray length) complexity - only iterates voxels the ray passes through
 * Uses spatial lookup for O(1) block existence checks
 * 
 * Reference: "A Fast Voxel Traversal Algorithm for Ray Tracing" (1987)
 */

// Pre-allocated reusable objects - ZERO GC pressure
const _hitPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

// Result object - reused every call
export interface VoxelHit {
  /** Hit position (render coords, block center) */
  point: THREE.Vector3;
  /** Surface normal of hit face */
  normal: THREE.Vector3;
  /** Grid position of hit voxel */
  voxelX: number;
  voxelY: number;
  voxelZ: number;
  /** Distance to hit */
  distance: number;
  /** What was hit */
  hitType: 'ground' | 'block' | 'fortress';
}

const _hitResult: VoxelHit = {
  point: _hitPoint,
  normal: _hitNormal,
  voxelX: 0,
  voxelY: 0,
  voxelZ: 0,
  distance: 0,
  hitType: 'ground'
};

// Block lookup - rebuilt when blocks change
let _blockSet: Set<string> | null = null;
let _blockVersion = 0;
let _lastBlocks: PlacedBlock[] | null = null;

/**
 * Build spatial lookup for blocks - O(n) but only when blocks change
 */
function ensureBlockLookup(blocks: PlacedBlock[]): Set<string> {
  // Fast path: same array reference and same length means no change
  if (_blockSet && _lastBlocks === blocks && _lastBlocks.length === blocks.length) {
    return _blockSet;
  }
  
  // Rebuild lookup
  _blockSet = new Set<string>();
  for (const block of blocks) {
    const key = `${block.position_x},${block.position_y},${block.position_z}`;
    _blockSet.add(key);
  }
  _lastBlocks = blocks;
  _blockVersion++;
  
  return _blockSet;
}

/**
 * Check if a voxel position contains a block - O(1)
 */
function hasBlock(x: number, y: number, z: number, lookup: Set<string>): boolean {
  return lookup.has(`${x},${y},${z}`);
}

/**
 * Check if position is inside fortress walls
 */
function isInsideFortress(x: number, y: number, z: number): boolean {
  const { cliffW, cliffH, frontZ, frontT, courtyardDepth, openingHalfW } = FORTRESS_DIMENSIONS;
  
  // Quick bounds check first
  if (y < 0 || y >= cliffH) return false;
  if (x < -cliffW / 2 || x > cliffW / 2) return false;
  if (z > frontZ || z < frontZ - courtyardDepth - frontT) return false;
  
  // Front wall (with opening in center)
  if (z >= frontZ - frontT && z <= frontZ) {
    if (Math.abs(x) > openingHalfW) {
      return true;
    }
  }
  
  // Side walls
  if (Math.abs(x) >= cliffW / 2 - 1) {
    if (z < frontZ && z > frontZ - courtyardDepth - frontT) {
      return true;
    }
  }
  
  // Back wall
  if (z <= frontZ - courtyardDepth - frontT + 1 && z >= frontZ - courtyardDepth - frontT - 1) {
    return true;
  }
  
  return false;
}

/**
 * Amanatides-Woo voxel traversal - ZERO allocations
 * 
 * @param origin Ray origin (camera position)
 * @param direction Ray direction (normalized)
 * @param maxDistance Maximum distance to traverse
 * @param blocks Array of placed blocks
 * @returns VoxelHit if something was hit, null otherwise
 */
export function voxelRaycast(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  blocks: PlacedBlock[]
): VoxelHit | null {
  // Build block lookup (fast path if unchanged)
  const blockLookup = ensureBlockLookup(blocks);
  
  // Copy to reusable vectors
  _rayOrigin.copy(origin);
  _rayDir.copy(direction);
  
  // Current voxel position (floor to get grid cell)
  let x = Math.floor(_rayOrigin.x);
  let y = Math.floor(_rayOrigin.y);
  let z = Math.floor(_rayOrigin.z);
  
  // Step direction (+1 or -1)
  const stepX = _rayDir.x >= 0 ? 1 : -1;
  const stepY = _rayDir.y >= 0 ? 1 : -1;
  const stepZ = _rayDir.z >= 0 ? 1 : -1;
  
  // Distance to next voxel boundary on each axis
  // tMaxX = distance along ray to first X boundary
  const nextBoundaryX = stepX > 0 ? x + 1 : x;
  const nextBoundaryY = stepY > 0 ? y + 1 : y;
  const nextBoundaryZ = stepZ > 0 ? z + 1 : z;
  
  // Handle division by zero for rays parallel to axes
  const tMaxX = _rayDir.x !== 0 ? (nextBoundaryX - _rayOrigin.x) / _rayDir.x : Infinity;
  const tMaxY = _rayDir.y !== 0 ? (nextBoundaryY - _rayOrigin.y) / _rayDir.y : Infinity;
  const tMaxZ = _rayDir.z !== 0 ? (nextBoundaryZ - _rayOrigin.z) / _rayDir.z : Infinity;
  
  // Distance along ray to move one voxel on each axis
  const tDeltaX = _rayDir.x !== 0 ? Math.abs(1 / _rayDir.x) : Infinity;
  const tDeltaY = _rayDir.y !== 0 ? Math.abs(1 / _rayDir.y) : Infinity;
  const tDeltaZ = _rayDir.z !== 0 ? Math.abs(1 / _rayDir.z) : Infinity;
  
  // Current t values for each axis
  let tX = tMaxX;
  let tY = tMaxY;
  let tZ = tMaxZ;
  
  // Track which axis we crossed last (for normal calculation)
  let lastAxis: 'x' | 'y' | 'z' = 'y';
  
  // Total distance traveled
  let t = 0;
  
  // Traverse voxels using Amanatides-Woo algorithm
  while (t < maxDistance) {
    // Check for ground hit (y = 0 plane, coming from above)
    if (y < 0 && lastAxis === 'y' && stepY < 0) {
      // Hit ground from above
      const groundT = -_rayOrigin.y / _rayDir.y;
      if (groundT > 0 && groundT < maxDistance) {
        _hitPoint.set(
          _rayOrigin.x + _rayDir.x * groundT,
          0,
          _rayOrigin.z + _rayDir.z * groundT
        );
        _hitNormal.set(0, 1, 0);
        _hitResult.point = _hitPoint;
        _hitResult.normal = _hitNormal;
        _hitResult.voxelX = Math.floor(_hitPoint.x);
        _hitResult.voxelY = 0;
        _hitResult.voxelZ = Math.floor(_hitPoint.z);
        _hitResult.distance = groundT;
        _hitResult.hitType = 'ground';
        return _hitResult;
      }
      return null; // Below ground, nothing to hit
    }
    
    // Check current voxel for collision (only if y >= 0)
    if (y >= 0) {
      // Check for block
      if (hasBlock(x, y, z, blockLookup)) {
        // Hit a block - calculate hit point and normal
        _hitPoint.set(
          _rayOrigin.x + _rayDir.x * t,
          _rayOrigin.y + _rayDir.y * t,
          _rayOrigin.z + _rayDir.z * t
        );
        
        // Normal is opposite of last step direction
        _hitNormal.set(0, 0, 0);
        if (lastAxis === 'x') _hitNormal.x = -stepX;
        else if (lastAxis === 'y') _hitNormal.y = -stepY;
        else _hitNormal.z = -stepZ;
        
        _hitResult.point = _hitPoint;
        _hitResult.normal = _hitNormal;
        _hitResult.voxelX = x;
        _hitResult.voxelY = y;
        _hitResult.voxelZ = z;
        _hitResult.distance = t;
        _hitResult.hitType = 'block';
        return _hitResult;
      }
      
      // Check for fortress wall
      if (isInsideFortress(x, y, z)) {
        _hitPoint.set(
          _rayOrigin.x + _rayDir.x * t,
          _rayOrigin.y + _rayDir.y * t,
          _rayOrigin.z + _rayDir.z * t
        );
        
        _hitNormal.set(0, 0, 0);
        if (lastAxis === 'x') _hitNormal.x = -stepX;
        else if (lastAxis === 'y') _hitNormal.y = -stepY;
        else _hitNormal.z = -stepZ;
        
        _hitResult.point = _hitPoint;
        _hitResult.normal = _hitNormal;
        _hitResult.voxelX = x;
        _hitResult.voxelY = y;
        _hitResult.voxelZ = z;
        _hitResult.distance = t;
        _hitResult.hitType = 'fortress';
        return _hitResult;
      }
    }
    
    // Step to next voxel - choose axis with smallest t
    if (tX < tY && tX < tZ) {
      t = tX;
      tX += tDeltaX;
      x += stepX;
      lastAxis = 'x';
    } else if (tY < tZ) {
      t = tY;
      tY += tDeltaY;
      y += stepY;
      lastAxis = 'y';
    } else {
      t = tZ;
      tZ += tDeltaZ;
      z += stepZ;
      lastAxis = 'z';
    }
  }
  
  return null; // Nothing hit within maxDistance
}

/**
 * Calculate where to place a block based on voxel raycast
 * ZERO ALLOCATIONS - returns pre-allocated result
 */
export interface PlacementTarget {
  /** Grid position to place block */
  x: number;
  y: number;
  z: number;
  /** Whether placement is valid */
  isValid: boolean;
  /** Reason for invalid placement */
  reason?: 'fortress' | 'waterfall' | 'overlap' | 'floating' | 'no-surface';
}

const _placementResult: PlacementTarget = {
  x: 0,
  y: 0,
  z: 0,
  isValid: false,
  reason: undefined
};

/**
 * Calculate block placement position using voxel raycast
 * INSTANT - no mesh creation, no allocations
 */
export function calculatePlacementFast(
  camera: THREE.Camera,
  blocks: PlacedBlock[],
  maxDistance: number = 5
): PlacementTarget {
  // Get camera direction
  _rayDir.set(0, 0, -1);
  _rayDir.applyQuaternion(camera.quaternion);
  _rayDir.normalize();
  
  // Raycast to find hit
  const hit = voxelRaycast(camera.position, _rayDir, maxDistance, blocks);
  
  if (!hit) {
    // No hit - try ground at max distance
    if (_rayDir.y < 0) {
      const groundT = -camera.position.y / _rayDir.y;
      if (groundT > 0 && groundT <= maxDistance) {
        const x = Math.floor(camera.position.x + _rayDir.x * groundT);
        const z = Math.floor(camera.position.z + _rayDir.z * groundT);
        
        // Validate
        const validation = validatePlacementFast(x, 0, z, blocks);
        _placementResult.x = x;
        _placementResult.y = 0;
        _placementResult.z = z;
        _placementResult.isValid = validation.isValid;
        _placementResult.reason = validation.reason;
        return _placementResult;
      }
    }
    
    _placementResult.isValid = false;
    _placementResult.reason = 'no-surface';
    return _placementResult;
  }
  
  // Calculate placement position (adjacent to hit surface)
  let placeX = hit.voxelX + Math.round(hit.normal.x);
  let placeY = hit.voxelY + Math.round(hit.normal.y);
  let placeZ = hit.voxelZ + Math.round(hit.normal.z);
  
  // Special case: hitting ground means place on top of it
  if (hit.hitType === 'ground') {
    placeX = hit.voxelX;
    placeY = 0;
    placeZ = hit.voxelZ;
  }
  
  // Ensure Y >= 0
  placeY = Math.max(0, placeY);
  
  // Validate placement
  const validation = validatePlacementFast(placeX, placeY, placeZ, blocks);
  
  _placementResult.x = placeX;
  _placementResult.y = placeY;
  _placementResult.z = placeZ;
  _placementResult.isValid = validation.isValid;
  _placementResult.reason = validation.reason;
  
  return _placementResult;
}

interface ValidationResult {
  isValid: boolean;
  reason?: PlacementTarget['reason'];
}

const _validationResult: ValidationResult = { isValid: false };

/**
 * Validate block placement - O(1) checks
 */
function validatePlacementFast(
  x: number, 
  y: number, 
  z: number, 
  blocks: PlacedBlock[]
): ValidationResult {
  const blockLookup = ensureBlockLookup(blocks);
  
  // Check fortress proximity (center at 0, 0, -20, radius 30)
  const fortressCenterX = 0;
  const fortressCenterZ = -20;
  const fortressMinDistance = 30;
  
  const dx = x - fortressCenterX;
  const dz = z - fortressCenterZ;
  const distSq = dx * dx + dz * dz;
  
  if (distSq < fortressMinDistance * fortressMinDistance) {
    _validationResult.isValid = false;
    _validationResult.reason = 'fortress';
    return _validationResult;
  }
  
  // Check waterfall blocking (x near 0, z > -6)
  const waterfallZ = -6;
  const waterfallBlockingWidth = 4;
  
  if (Math.abs(x) < waterfallBlockingWidth / 2 && z > waterfallZ) {
    _validationResult.isValid = false;
    _validationResult.reason = 'waterfall';
    return _validationResult;
  }
  
  // Check overlap - O(1)
  if (hasBlock(x, y, z, blockLookup)) {
    _validationResult.isValid = false;
    _validationResult.reason = 'overlap';
    return _validationResult;
  }
  
  // Check support (on ground OR adjacent to existing block)
  if (y === 0) {
    _validationResult.isValid = true;
    _validationResult.reason = undefined;
    return _validationResult;
  }
  
  // Check adjacency (any face touching existing block)
  const hasSupport = 
    hasBlock(x - 1, y, z, blockLookup) ||
    hasBlock(x + 1, y, z, blockLookup) ||
    hasBlock(x, y - 1, z, blockLookup) ||
    hasBlock(x, y + 1, z, blockLookup) ||
    hasBlock(x, y, z - 1, blockLookup) ||
    hasBlock(x, y, z + 1, blockLookup);
  
  if (!hasSupport) {
    _validationResult.isValid = false;
    _validationResult.reason = 'floating';
    return _validationResult;
  }
  
  _validationResult.isValid = true;
  _validationResult.reason = undefined;
  return _validationResult;
}

/**
 * Force rebuild of block lookup (call when blocks array changes)
 */
export function invalidateBlockLookup(): void {
  _lastBlocks = null;
}
