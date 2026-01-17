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
  
  // Check for ground intersection FIRST if looking down
  if (_rayDir.y < -0.001) {
    const groundT = -_rayOrigin.y / _rayDir.y;
    if (groundT > 0 && groundT <= maxDistance) {
      const groundX = _rayOrigin.x + _rayDir.x * groundT;
      const groundZ = _rayOrigin.z + _rayDir.z * groundT;
      
      // Check if any block is hit before ground
      let hitBlockBeforeGround = false;
      
      // Quick check: iterate through trajectory to ground
      let x = Math.floor(_rayOrigin.x);
      let y = Math.floor(_rayOrigin.y);
      let z = Math.floor(_rayOrigin.z);
      
      const stepX = _rayDir.x >= 0 ? 1 : -1;
      const stepY = _rayDir.y >= 0 ? 1 : -1;
      const stepZ = _rayDir.z >= 0 ? 1 : -1;
      
      const nextBoundaryX = stepX > 0 ? x + 1 : x;
      const nextBoundaryY = stepY > 0 ? y + 1 : y;
      const nextBoundaryZ = stepZ > 0 ? z + 1 : z;
      
      let tX = _rayDir.x !== 0 ? (nextBoundaryX - _rayOrigin.x) / _rayDir.x : Infinity;
      let tY = _rayDir.y !== 0 ? (nextBoundaryY - _rayOrigin.y) / _rayDir.y : Infinity;
      let tZ = _rayDir.z !== 0 ? (nextBoundaryZ - _rayOrigin.z) / _rayDir.z : Infinity;
      
      const tDeltaX = _rayDir.x !== 0 ? Math.abs(1 / _rayDir.x) : Infinity;
      const tDeltaY = _rayDir.y !== 0 ? Math.abs(1 / _rayDir.y) : Infinity;
      const tDeltaZ = _rayDir.z !== 0 ? Math.abs(1 / _rayDir.z) : Infinity;
      
      let t = 0;
      let lastAxis: 'x' | 'y' | 'z' = 'y';
      
      while (t < groundT && t < maxDistance && y >= 0) {
        // Check current voxel for block
        if (y >= 0 && hasBlock(x, y, z, blockLookup)) {
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
          _hitResult.hitType = 'block';
          hitBlockBeforeGround = true;
          return _hitResult;
        }
        
        // Step to next voxel
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
      
      // No block hit, return ground hit
      if (!hitBlockBeforeGround) {
        _hitPoint.set(groundX, 0, groundZ);
        _hitNormal.set(0, 1, 0);
        _hitResult.point = _hitPoint;
        _hitResult.normal = _hitNormal;
        _hitResult.voxelX = Math.floor(groundX);
        _hitResult.voxelY = 0;
        _hitResult.voxelZ = Math.floor(groundZ);
        _hitResult.distance = groundT;
        _hitResult.hitType = 'ground';
        return _hitResult;
      }
    }
  }
  
  // Looking up or horizontal - traverse voxels for blocks only
  let x = Math.floor(_rayOrigin.x);
  let y = Math.floor(_rayOrigin.y);
  let z = Math.floor(_rayOrigin.z);
  
  const stepX = _rayDir.x >= 0 ? 1 : -1;
  const stepY = _rayDir.y >= 0 ? 1 : -1;
  const stepZ = _rayDir.z >= 0 ? 1 : -1;
  
  const nextBoundaryX = stepX > 0 ? x + 1 : x;
  const nextBoundaryY = stepY > 0 ? y + 1 : y;
  const nextBoundaryZ = stepZ > 0 ? z + 1 : z;
  
  let tX = _rayDir.x !== 0 ? (nextBoundaryX - _rayOrigin.x) / _rayDir.x : Infinity;
  let tY = _rayDir.y !== 0 ? (nextBoundaryY - _rayOrigin.y) / _rayDir.y : Infinity;
  let tZ = _rayDir.z !== 0 ? (nextBoundaryZ - _rayOrigin.z) / _rayDir.z : Infinity;
  
  const tDeltaX = _rayDir.x !== 0 ? Math.abs(1 / _rayDir.x) : Infinity;
  const tDeltaY = _rayDir.y !== 0 ? Math.abs(1 / _rayDir.y) : Infinity;
  const tDeltaZ = _rayDir.z !== 0 ? Math.abs(1 / _rayDir.z) : Infinity;
  
  let t = 0;
  let lastAxis: 'x' | 'y' | 'z' = 'y';
  
  while (t < maxDistance) {
    // Check current voxel for block
    if (y >= 0 && hasBlock(x, y, z, blockLookup)) {
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
      _hitResult.hitType = 'block';
      return _hitResult;
    }
    
    // Step to next voxel
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
    
    // Early exit if going below ground
    if (y < 0) break;
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
  
  // Check fortress proximity - SMALLER radius, only blocks the fortress itself
  const { cliffW, courtyardDepth, frontZ, frontT } = FORTRESS_DIMENSIONS;
  const fortressCenterX = 0;
  const fortressCenterZ = frontZ - courtyardDepth / 2;
  const fortressRadiusX = cliffW / 2 + 2;
  const fortressRadiusZ = courtyardDepth / 2 + frontT + 2;
  
  // Check if inside fortress bounding box
  if (Math.abs(x - fortressCenterX) < fortressRadiusX && 
      Math.abs(z - fortressCenterZ) < fortressRadiusZ) {
    _validationResult.isValid = false;
    _validationResult.reason = 'fortress';
    return _validationResult;
  }
  
  // Check waterfall blocking - narrow column at center
  const waterfallZ = -6;
  const waterfallBlockingWidth = 2;
  
  if (Math.abs(x) < waterfallBlockingWidth && z > waterfallZ && z < frontZ) {
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
