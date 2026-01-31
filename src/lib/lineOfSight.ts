/**
 * Universal Line-of-Sight Service
 *
 * Reusable visibility checking for any entity in the game.
 * Used by enemies, turrets, NPCs, security systems, etc.
 *
 * Features:
 * - Point-to-point visibility checks
 * - Batch operations for multiple observers/targets
 * - Uses voxel raycast for block occlusion
 * - Zero allocations in hot path
 */

import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { voxelRaycast } from './voxelRaycast';
import { playerTracker, PlayerState } from './playerTracker';

// Pre-allocated vectors (zero GC)
const _fromPos = new THREE.Vector3();
const _toPos = new THREE.Vector3();
const _direction = new THREE.Vector3();

export interface LineOfSightOptions {
  /** Maximum check distance (default: 64 blocks) */
  maxDistance?: number;
  /** Skip block occlusion checks */
  ignoreBlocks?: boolean;
  /** Height offset for observer (e.g., eye level) */
  observerHeight?: number;
  /** Height offset for target (e.g., center mass) */
  targetHeight?: number;
  /** Can see through transparent blocks (not implemented yet) */
  throughTransparent?: boolean;
}

export interface LineOfSightResult {
  /** Whether target is visible */
  visible: boolean;
  /** Distance to target (or to blocking point) */
  distance: number;
  /** What blocked the view (if not visible) */
  blockedBy?: 'block' | 'ground' | 'distance';
  /** Point where view was blocked */
  hitPoint?: THREE.Vector3;
}

// Reusable result object
const _losResult: LineOfSightResult = {
  visible: false,
  distance: 0,
  blockedBy: undefined,
  hitPoint: undefined,
};

/**
 * Check if there's a clear line of sight between two points
 */
export function hasLineOfSight(
  from: THREE.Vector3,
  to: THREE.Vector3,
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): LineOfSightResult {
  const {
    maxDistance = 64,
    ignoreBlocks = false,
    observerHeight = 0,
    targetHeight = 0,
  } = options;

  // Apply height offsets
  _fromPos.copy(from);
  _fromPos.y += observerHeight;

  _toPos.copy(to);
  _toPos.y += targetHeight;

  // Calculate direction and distance
  _direction.copy(_toPos).sub(_fromPos);
  const distance = _direction.length();

  // Check max distance
  if (distance > maxDistance) {
    _losResult.visible = false;
    _losResult.distance = distance;
    _losResult.blockedBy = 'distance';
    _losResult.hitPoint = undefined;
    return _losResult;
  }

  // Normalize direction
  if (distance > 0.001) {
    _direction.divideScalar(distance);
  }

  // If ignoring blocks, just return visible
  if (ignoreBlocks || blocks.length === 0) {
    _losResult.visible = true;
    _losResult.distance = distance;
    _losResult.blockedBy = undefined;
    _losResult.hitPoint = undefined;
    return _losResult;
  }

  // Cast ray to check for block occlusion
  const hit = voxelRaycast(_fromPos, _direction, distance, blocks);

  if (hit && hit.distance < distance - 0.1) {
    // Something blocked the view before reaching target
    _losResult.visible = false;
    _losResult.distance = hit.distance;
    _losResult.blockedBy = hit.hitType === 'ground' ? 'ground' : 'block';
    _losResult.hitPoint = hit.point.clone();
    return _losResult;
  }

  // Clear line of sight
  _losResult.visible = true;
  _losResult.distance = distance;
  _losResult.blockedBy = undefined;
  _losResult.hitPoint = undefined;
  return _losResult;
}

/**
 * Filter an array of targets to only those visible from observer position
 */
export function getVisibleTargets<T extends { position: THREE.Vector3 }>(
  from: THREE.Vector3,
  targets: T[],
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): T[] {
  const result: T[] = [];

  for (const target of targets) {
    const los = hasLineOfSight(from, target.position, blocks, options);
    if (los.visible) {
      result.push(target);
    }
  }

  return result;
}

/**
 * Cast a ray and return hit information (without block lookup)
 * Useful for direction/distance calculations
 */
export function castRay(
  from: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number
): { endpoint: THREE.Vector3; distance: number } {
  const endpoint = new THREE.Vector3()
    .copy(from)
    .addScaledVector(direction, maxDistance);

  return {
    endpoint,
    distance: maxDistance,
  };
}

/**
 * Get direction from observer to target
 */
export function getDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  return _direction.copy(to).sub(from).normalize();
}

/**
 * Get distance between two points
 */
export function getDistance(from: THREE.Vector3, to: THREE.Vector3): number {
  return from.distanceTo(to);
}

/**
 * Batch visibility check for multiple observers against multiple targets
 * More efficient than individual checks when many entities need LoS
 */
export function batchVisibilityCheck(
  observers: Array<{ id: string; position: THREE.Vector3 }>,
  targets: Array<{ id: string; position: THREE.Vector3 }>,
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const observer of observers) {
    const visibleTargetIds: string[] = [];

    for (const target of targets) {
      const los = hasLineOfSight(observer.position, target.position, blocks, options);
      if (los.visible) {
        visibleTargetIds.push(target.id);
      }
    }

    result.set(observer.id, visibleTargetIds);
  }

  return result;
}

// ============================================
// Player-specific helpers (combines with playerTracker)
// ============================================

/**
 * Get all players visible from a position
 */
export function getVisiblePlayers(
  from: THREE.Vector3,
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): PlayerState[] {
  const maxDistance = options.maxDistance ?? 64;

  // First get players in range (fast spatial query)
  const nearbyPlayers = playerTracker.getPlayersInRange(from, maxDistance);

  // Then filter by LoS
  return nearbyPlayers.filter(player => {
    const los = hasLineOfSight(from, player.position, blocks, options);
    return los.visible;
  });
}

/**
 * Get the nearest visible player from a position
 */
export function getNearestVisiblePlayer(
  from: THREE.Vector3,
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): PlayerState | null {
  const maxDistance = options.maxDistance ?? 64;

  // Get players in range, sorted by distance
  const nearbyPlayers = playerTracker.getPlayersInRange(from, maxDistance);

  // Sort by distance
  nearbyPlayers.sort((a, b) => {
    const distA = from.distanceToSquared(a.position);
    const distB = from.distanceToSquared(b.position);
    return distA - distB;
  });

  // Return first visible one
  for (const player of nearbyPlayers) {
    const los = hasLineOfSight(from, player.position, blocks, options);
    if (los.visible) {
      return player;
    }
  }

  return null;
}

/**
 * Check if a specific player is visible from a position
 */
export function canSeePlayer(
  from: THREE.Vector3,
  playerId: string,
  blocks: PlacedBlock[],
  options: LineOfSightOptions = {}
): boolean {
  const player = playerTracker.getPlayerById(playerId);
  if (!player) return false;

  const los = hasLineOfSight(from, player.position, blocks, options);
  return los.visible;
}

/**
 * Calculate angle (in radians) between observer's forward direction and target
 * Useful for field-of-view checks
 */
export function getAngleToTarget(
  observerPos: THREE.Vector3,
  observerForward: THREE.Vector3,
  targetPos: THREE.Vector3
): number {
  _direction.copy(targetPos).sub(observerPos).normalize();
  return Math.acos(Math.max(-1, Math.min(1, observerForward.dot(_direction))));
}

/**
 * Check if target is within a cone of vision
 */
export function isInFieldOfView(
  observerPos: THREE.Vector3,
  observerForward: THREE.Vector3,
  targetPos: THREE.Vector3,
  fovRadians: number
): boolean {
  const angle = getAngleToTarget(observerPos, observerForward, targetPos);
  return angle <= fovRadians / 2;
}
