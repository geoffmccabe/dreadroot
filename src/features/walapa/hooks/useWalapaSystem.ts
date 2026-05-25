import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { WalapaDefinition, WalapaInstance } from '../types';
import {
  MAX_WALAPAS_TOTAL,
  WALAPA_BASE_SPEED,
  WALAPA_FLOAT_HEIGHT,
  WALAPA_BOB_AMPLITUDE,
  WALAPA_BOB_SPEED,
  WALAPA_TAIL_SPEED,
  WALAPA_SEARCH_RADIUS,
  WALAPA_OBSTACLE_AVOIDANCE_DISTANCE,
  WALAPA_WAYPOINT_ARRIVAL_THRESHOLD,
  WALAPA_SCALE_VARIATION,
} from '../constants';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { WALAPA_HITBOX_RADIUS, WALAPA_HITBOX_HEIGHT } from '../constants';

// Spawn check interval in ms
const SPAWN_CHECK_INTERVAL_MS = 10000;
// Target walapas per trees (1 walapa per N trees)
const WALAPAS_PER_TREES = 5;

// Clearance above trees when pathing
const PATH_CLEARANCE_HEIGHT = 5;
// How close a tree needs to be to the path to be considered an obstacle
const PATH_OBSTACLE_RADIUS = 8;

// Minimum tree tier for walapas to visit
const MIN_TREE_TIER_FOR_WALAPAS = 1;

// Sound settings
const WALAPA_SOUND_URL = '/walapa_v1.mp3';
const WALAPA_SOUND_CHECK_INTERVAL_MS = 60000; // Check every 60 seconds (1 minute)
const WALAPA_RANDOM_SOUND_CHANCE = 0.01; // 1% chance per check
const WALAPA_SOUND_VOLUME = 0.7;

// Track if sounds have been preloaded
let soundsPreloaded = false;

interface UseWalapaSystemOptions {
  definitions: WalapaDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  /** Get all trees for walapa targeting */
  getEligibleTrees: () => { id: string; position: THREE.Vector3; tier: number; topY: number }[];
  onWalapaKilled?: (tier: number) => void;
}

/**
 * Check if a point is near a line segment (2D, ignoring Y)
 */
function pointNearLineSegment2D(
  px: number, pz: number,
  x1: number, z1: number,
  x2: number, z2: number,
  radius: number
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq === 0) {
    // Start and end are the same point
    const dist = Math.sqrt((px - x1) ** 2 + (pz - z1) ** 2);
    return dist < radius;
  }

  // Project point onto line segment
  let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const nearestX = x1 + t * dx;
  const nearestZ = z1 + t * dz;
  const dist = Math.sqrt((px - nearestX) ** 2 + (pz - nearestZ) ** 2);

  return dist < radius;
}

/**
 * Calculate path waypoints to avoid obstacles (trees)
 * Simple approach: go up to clear obstacles, fly horizontal, descend to target
 */
function calculatePathWaypoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  trees: { id: string; position: THREE.Vector3; tier: number; topY: number }[],
  excludeTreeId: string | null
): THREE.Vector3[] {
  // Find trees that block the direct path
  let maxObstacleHeight = Math.max(start.y, end.y); // Start with our current flight level

  for (const tree of trees) {
    if (tree.id === excludeTreeId) continue;

    // Check if tree is in the XZ corridor between start and end
    if (pointNearLineSegment2D(
      tree.position.x, tree.position.z,
      start.x, start.z,
      end.x, end.z,
      PATH_OBSTACLE_RADIUS
    )) {
      // This tree is in our path - check if it's taller than our flight level
      if (tree.topY > maxObstacleHeight) {
        maxObstacleHeight = tree.topY;
      }
    }
  }

  // The safe height is just above the tallest obstacle in our path
  const safeHeight = maxObstacleHeight + PATH_CLEARANCE_HEIGHT;

  // If we're already above all obstacles, fly direct
  if (start.y >= safeHeight && end.y >= safeHeight - PATH_CLEARANCE_HEIGHT) {
    return [end.clone()];
  }

  // Build waypoints: up -> across -> down (if needed)
  const waypoints: THREE.Vector3[] = [];

  // Only add rise waypoint if we need to go up
  if (safeHeight > start.y + 2) {
    waypoints.push(new THREE.Vector3(start.x, safeHeight, start.z));
  }

  // Only add horizontal waypoint if destination is lower than safe height
  if (end.y < safeHeight - 2) {
    waypoints.push(new THREE.Vector3(end.x, safeHeight, end.z));
  }

  // Final destination (the treetop)
  waypoints.push(end.clone());

  return waypoints;
}

/**
 * Hook to manage active walapas with tree-floating behavior
 */
export function useWalapaSystem({
  definitions,
  cameraRef,
  isEnabled,
  getEligibleTrees,
  onWalapaKilled,
}: UseWalapaSystemOptions) {
  const [walapas, setWalapas] = useState<WalapaInstance[]>([]);
  const walapasRef = useRef<WalapaInstance[]>([]);

  // Keep ref in sync
  useEffect(() => {
    walapasRef.current = walapas;
  }, [walapas]);

  // Preload sounds on first mount (deferred to avoid blocking initialization)
  useEffect(() => {
    if (!soundsPreloaded) {
      soundsPreloaded = true;
      preloadSpatialSounds([WALAPA_SOUND_URL]).catch((e) => {
        console.warn('[Walapa] Failed to preload sounds:', e);
      });
    }
  }, []);

  /**
   * Get definition by tier
   */
  const getDefinitionByTier = useCallback((tier: number): WalapaDefinition | null => {
    const actualTier = tier === 0 ? 10 : tier;
    return definitions?.find(d => d.tier === actualTier) ?? null;
  }, [definitions]);

  /**
   * Find the closest eligible tree for a walapa
   */
  const findClosestTree = useCallback((
    currentPosition: THREE.Vector3,
    minTreeTier: number,
    excludeTreeId?: string
  ): { id: string; position: THREE.Vector3; topY: number } | null => {
    const trees = getEligibleTrees();

    const effectiveMinTier = Math.max(MIN_TREE_TIER_FOR_WALAPAS, minTreeTier || MIN_TREE_TIER_FOR_WALAPAS);

    // Filter by min tier, exclude current tree, and ensure valid data
    const eligible = trees.filter(t =>
      t.tier >= effectiveMinTier &&
      t.id !== excludeTreeId &&
      !isNaN(t.position.x) && !isNaN(t.position.z) && !isNaN(t.topY)
    );

    if (eligible.length === 0) {
      return null;
    }

    // Find the closest one
    let closest = eligible[0];
    let closestDist = currentPosition.distanceTo(closest.position);

    for (let i = 1; i < eligible.length; i++) {
      const dist = currentPosition.distanceTo(eligible[i].position);
      if (dist < closestDist) {
        closest = eligible[i];
        closestDist = dist;
      }
    }

    return {
      id: closest.id,
      position: closest.position.clone(),
      topY: closest.topY,
    };
  }, [getEligibleTrees]);

  /**
   * Find a random eligible tree for a walapa (for tree-to-tree travel)
   * Walapas pick random trees ANYWHERE on the map (not just nearby)
   */
  const findRandomTree = useCallback((
    currentPosition: THREE.Vector3,
    minTreeTier: number,
    excludeTreeId?: string
  ): { id: string; position: THREE.Vector3; topY: number } | null => {
    const trees = getEligibleTrees();

    const effectiveMinTier = Math.max(MIN_TREE_TIER_FOR_WALAPAS, minTreeTier || MIN_TREE_TIER_FOR_WALAPAS);

    // Filter by min tier and exclude current tree - search ALL trees on the map
    const eligible = trees.filter(t =>
      t.tier >= effectiveMinTier &&
      t.id !== excludeTreeId &&
      !isNaN(t.position.x) && !isNaN(t.position.z) && !isNaN(t.topY)
    );

    if (eligible.length === 0) {
      return null;
    }

    // Pick a random tree from ALL eligible trees on the map
    const tree = eligible[Math.floor(Math.random() * eligible.length)];

    return {
      id: tree.id,
      position: tree.position.clone(),
      topY: tree.topY,
    };
  }, [getEligibleTrees]);

  /**
   * Spawn a walapa at a position (only if eligible trees exist)
   */
  const spawnWalapaAt = useCallback((
    definition: WalapaDefinition,
    position: THREE.Vector3,
  ): WalapaInstance | null => {
    if (walapasRef.current.length >= MAX_WALAPAS_TOTAL) {
      return null;
    }

    // Find an eligible tree to start at
    const targetTree = findClosestTree(position, MIN_TREE_TIER_FOR_WALAPAS);

    // Walapas require eligible trees to exist
    if (!targetTree) {
      return null;
    }

    const id = `walapa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scale = 1 + (Math.random() * 2 - 1) * WALAPA_SCALE_VARIATION;

    // Start position: at tree's top + float height
    const startPos = new THREE.Vector3(
      targetTree.position.x,
      targetTree.topY + WALAPA_FLOAT_HEIGHT,
      targetTree.position.z
    );

    const instance: WalapaInstance = {
      id,
      definition,
      position: startPos,
      rotation: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      spawnedAt: Date.now(),
      velocity: new THREE.Vector3(0, 0, 0),
      state: 'waiting',
      targetTreePosition: null,
      currentTreeId: targetTree.id,
      waitStartTime: Date.now(),
      bobPhase: Math.random() * Math.PI * 2,
      tailPhase: Math.random() * Math.PI * 2,
      pathWaypoints: [],
      currentWaypointIndex: 0,
      scale,
      riders: [],
    };

    const newWalapas = [...walapasRef.current, instance];
    walapasRef.current = newWalapas;
    setWalapas(newWalapas);

    return instance;
  }, [findClosestTree]);

  /**
   * Check if a position has collider interference using the world collision grid.
   * Tests a bounding box roughly walapa-sized at the given position.
   */
  const hasColliderAt = useCallback((x: number, y: number, z: number, halfSize: number = 5): boolean => {
    const count = worldCollisionGrid.getNearbyFiltered(x, z, halfSize, y - 2, y + 4);
    return count > 0;
  }, []);

  /**
   * Spawn a walapa of a given tier near player.
   * Appears 6 blocks in front and 6 blocks above the player.
   * If colliders are in the way, searches upward until clear.
   */
  const spawnWalapa = useCallback((tier: number): WalapaInstance | null => {
    console.log(`[Walapa] spawnWalapa called for tier ${tier}, current count: ${walapasRef.current.length}`);

    const definition = getDefinitionByTier(tier);
    if (!definition) {
      console.warn(`[Walapa] No definition for tier ${tier}, definitions available:`, definitions?.map(d => d.tier));
      return null;
    }

    const camera = cameraRef.current;
    if (!camera) {
      console.warn('[Walapa] Cannot spawn - no camera');
      return null;
    }

    // 6 blocks in front of player (horizontal only)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const spawnX = camera.position.x + forward.x * 6;
    const spawnZ = camera.position.z + forward.z * 6;
    let spawnY = camera.position.y + 6; // 6 blocks above

    // Search upward if colliders are in the way (up to 500 blocks)
    const MAX_SEARCH_HEIGHT = 500;
    let searchY = spawnY;
    while (hasColliderAt(spawnX, searchY, spawnZ) && searchY < spawnY + MAX_SEARCH_HEIGHT) {
      searchY += 2; // Step up 2 blocks at a time
    }
    spawnY = searchY;

    const spawnPos = new THREE.Vector3(spawnX, spawnY, spawnZ);

    console.log(`[Walapa] Spawning at position: (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})`);
    return spawnWalapaAt(definition, spawnPos);
  }, [cameraRef, getDefinitionByTier, spawnWalapaAt, definitions, hasColliderAt]);

  /**
   * Damage a walapa
   */
  const damageWalapa = useCallback((
    walapaId: string,
    damage: number,
  ): boolean => {
    const walapa = walapasRef.current.find(w => w.id === walapaId);
    if (!walapa || !walapa.isActive) return false;

    walapa.currentHealth -= damage;

    if (walapa.currentHealth <= 0) {
      walapa.isActive = false;
      onWalapaKilled?.(walapa.definition.tier);

      // Remove from list
      walapasRef.current = walapasRef.current.filter(w => w.id !== walapaId);
      setWalapas(walapasRef.current);

      console.log(`[Walapa] Killed ${walapaId}`);
      return true;
    }

    setWalapas([...walapasRef.current]);
    return false;
  }, [onWalapaKilled]);

  /**
   * Clear all walapas
   */
  const clearAllWalapas = useCallback(() => {
    walapasRef.current = [];
    setWalapas([]);
  }, []);

  /**
   * Movement update - float between trees
   */
  const updateMovement = useCallback((deltaTime: number) => {
    if (!isEnabled) return;

    const now = Date.now();

    for (const walapa of walapasRef.current) {
      if (!walapa.isActive) continue;

      // Update animations
      walapa.bobPhase += deltaTime * WALAPA_BOB_SPEED;
      walapa.tailPhase += deltaTime * WALAPA_TAIL_SPEED;

      // State machine
      switch (walapa.state) {
        case 'waiting': {
          // Check if wait time is over (30 seconds default)
          const waitTime = (walapa.definition.wait_time_seconds || 30) * 1000;
          if (now - walapa.waitStartTime >= waitTime) {
            // Find next tree ANYWHERE on the map
            const nextTree = findRandomTree(
              walapa.position,
              MIN_TREE_TIER_FOR_WALAPAS,
              walapa.currentTreeId || undefined
            );

            if (nextTree) {
              // Target position: on top of tree + float height
              const targetPos = new THREE.Vector3(
                nextTree.position.x,
                nextTree.topY + WALAPA_FLOAT_HEIGHT,
                nextTree.position.z
              );

              walapa.targetTreePosition = targetPos;
              walapa.currentTreeId = nextTree.id;

              // Calculate path with obstacle avoidance
              const trees = getEligibleTrees();
              walapa.pathWaypoints = calculatePathWaypoints(
                walapa.position,
                targetPos,
                trees,
                nextTree.id
              );
              walapa.currentWaypointIndex = 0;

              if (walapa.pathWaypoints.length > 0) {
                walapa.state = 'traveling';
              }
            } else {
              // No eligible tree found - keep waiting
              walapa.waitStartTime = now;
            }
          }
          break;
        }

        case 'traveling': {
          if (!walapa.targetTreePosition || walapa.pathWaypoints.length === 0) {
            walapa.state = 'waiting';
            walapa.waitStartTime = now;
            break;
          }

          // Get current waypoint
          const currentWaypoint = walapa.pathWaypoints[walapa.currentWaypointIndex];
          if (!currentWaypoint) {
            // No more waypoints - arrive at destination
            walapa.position.copy(walapa.targetTreePosition);
            walapa.state = 'arriving';
            break;
          }

          // Move toward current waypoint
          const toWaypoint = new THREE.Vector3().subVectors(currentWaypoint, walapa.position);
          const distance = toWaypoint.length();

          if (distance < WALAPA_WAYPOINT_ARRIVAL_THRESHOLD) {
            // Arrived at waypoint - snap to it and move to next
            walapa.position.copy(currentWaypoint);
            walapa.currentWaypointIndex++;

            if (walapa.currentWaypointIndex >= walapa.pathWaypoints.length) {
              // Final waypoint reached - arrive
              walapa.position.copy(walapa.targetTreePosition);
              walapa.state = 'arriving';
            }
          } else {
            // Move toward waypoint
            toWaypoint.normalize();

            const speedMultiplier = (walapa.definition.speed || 100) / 100;
            const moveSpeed = WALAPA_BASE_SPEED * speedMultiplier;

            walapa.velocity.copy(toWaypoint).multiplyScalar(moveSpeed);
            walapa.position.add(walapa.velocity.clone().multiplyScalar(deltaTime));

            // Face direction of travel
            walapa.rotation = Math.atan2(toWaypoint.x, toWaypoint.z);
          }
          break;
        }

        case 'arriving': {
          // Arrived at destination - play sound and start waiting
          walapa.state = 'waiting';
          walapa.waitStartTime = now;
          walapa.targetTreePosition = null;
          walapa.pathWaypoints = [];

          // Play arrival sound (ALWAYS when arriving at a tree)
          const camera = cameraRef.current;
          if (camera) {
            const distance = walapa.position.distanceTo(camera.position);
            if (distance < 150) {
              playSpatialSound(WALAPA_SOUND_URL, distance, { baseVolume: WALAPA_SOUND_VOLUME });
            }
          }
          break;
        }
      }
    }
  }, [isEnabled, findRandomTree, getEligibleTrees, cameraRef]);

  /**
   * Add a rider to a walapa
   */
  const addRider = useCallback((walapaId: string, playerId: string): boolean => {
    const walapa = walapasRef.current.find(w => w.id === walapaId);
    if (!walapa || !walapa.isActive) return false;

    if (!walapa.riders.includes(playerId)) {
      walapa.riders.push(playerId);
      setWalapas([...walapasRef.current]);
      return true;
    }
    return false;
  }, []);

  /**
   * Remove a rider from a walapa
   */
  const removeRider = useCallback((walapaId: string, playerId: string): boolean => {
    const walapa = walapasRef.current.find(w => w.id === walapaId);
    if (!walapa) return false;

    const idx = walapa.riders.indexOf(playerId);
    if (idx !== -1) {
      walapa.riders.splice(idx, 1);
      setWalapas([...walapasRef.current]);
      return true;
    }
    return false;
  }, []);

  /**
   * Auto-spawn walapas based on tree count (1 per 10 eligible trees)
   */
  useEffect(() => {
    if (!isEnabled || !definitions || definitions.length === 0) return;

    const checkAndSpawn = () => {
      const allTrees = getEligibleTrees();

      // Filter to eligible trees
      const eligibleTrees = allTrees.filter(t =>
        t.tier >= MIN_TREE_TIER_FOR_WALAPAS &&
        !isNaN(t.position.x) && !isNaN(t.position.z) && !isNaN(t.topY)
      );

      const targetWalapas = Math.max(0, Math.floor(eligibleTrees.length / WALAPAS_PER_TREES));
      const currentWalapas = walapasRef.current.filter(w => w.isActive).length;

      // Only spawn if there are eligible trees and we need more walapas
      if (currentWalapas < targetWalapas && eligibleTrees.length > 0) {
        const tree = eligibleTrees[Math.floor(Math.random() * eligibleTrees.length)];
        const def = definitions.find(d => d.tier === 1) || definitions[0];

        if (def && tree) {
          const spawnPos = new THREE.Vector3(
            tree.position.x,
            tree.topY + WALAPA_FLOAT_HEIGHT,
            tree.position.z
          );
          spawnWalapaAt(def, spawnPos);
        }
      }
    };

    // Initial check after a short delay
    const initialTimer = setTimeout(checkAndSpawn, 3000);

    // Periodic check
    const interval = setInterval(checkAndSpawn, SPAWN_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isEnabled, definitions, getEligibleTrees, spawnWalapaAt]);

  /**
   * Random ambient sound - 1% chance per walapa per minute
   */
  useEffect(() => {
    if (!isEnabled) return;

    const soundCheck = () => {
      const camera = cameraRef.current;
      if (!camera) return;

      for (const walapa of walapasRef.current) {
        if (!walapa.isActive) continue;

        // 1% chance per walapa
        if (Math.random() < WALAPA_RANDOM_SOUND_CHANCE) {
          const distance = walapa.position.distanceTo(camera.position);
          // Only play if within reasonable distance (150 blocks)
          if (distance < 150) {
            playSpatialSound(WALAPA_SOUND_URL, distance, { baseVolume: WALAPA_SOUND_VOLUME });
          }
        }
      }
    };

    const interval = setInterval(soundCheck, WALAPA_SOUND_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isEnabled, cameraRef]);

  // EnemyCombatRegistry adapter — universal bullet + flame dispatch.
  useEffect(() => {
    return enemyCombatRegistry.register({
      type: 'walapa',
      getActiveEnemies: () => walapasRef.current,
      getId: (w) => w.id,
      getHitbox: (w) => {
        if (!w.isActive) return null;
        const scale = w.scale ?? 1;
        return {
          centerX: w.position.x,
          centerZ: w.position.z,
          bottomY: w.position.y,
          topY: w.position.y + WALAPA_HITBOX_HEIGHT * scale,
          radius: WALAPA_HITBOX_RADIUS * scale,
        };
      },
      applyDamage: (w, info) => {
        return damageWalapa(w.id, info.damage);
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
    });
  }, [damageWalapa]);

  return {
    walapas,
    walapasRef,
    spawnWalapa,
    spawnWalapaAt,
    getDefinitionByTier,
    damageWalapa,
    clearAllWalapas,
    updateMovement,
    addRider,
    removeRider,
  };
}
