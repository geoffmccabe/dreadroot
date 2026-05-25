import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShtickmanDefinition, ShtickmanInstance } from '../types';
import { getHeightBlocks, getHeadSizeBlocks } from '../types';
import {
  MAX_TOTAL_SHTICKMEN,
  SPAWN_MIN_DISTANCE,
  SPAWN_MAX_DISTANCE,
  EXISTENCE_CHECK_INTERVAL_MS,
  SHTICKMAN_GRAVITY,
  SHTICKMAN_SCALE_VARIATION,
  ROAR_CHANCE,
  ROAR_CHECK_INTERVAL_MS,
  ROAR_VOLUME,
  PROXIMITY_SOUND_DISTANCE,
  PROXIMITY_SOUND_COOLDOWN_MS,
  PROXIMITY_SOUND_VOLUME,
  DEFAULT_PROXIMITY_SOUND_URL,
} from '../constants';
import { playSpatialSound } from '@/lib/spatialAudio';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { SHTICKMAN_HITBOX_RADIUS } from '../constants';
import { pathfindingService } from '@/lib/pathfinding';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import type { PlantedTree } from '@/features/trees/types';

// Minimum tree tier for patrol targets
const MIN_PATROL_TREE_TIER = 5;

// How often to recalculate path (ms)
const PATHFIND_INTERVAL_MS = 1500; // More frequent recalculation for better navigation

// How close to waypoint before moving to next (larger for grid size 2)
const WAYPOINT_REACH_DISTANCE = 3.0;

// How close to tree to consider "touched"
const TREE_TOUCH_DISTANCE = 5.0;

// Time to wait at tree before picking next (ms)
const TREE_WAIT_TIME_MS = 2000;

interface UseShtickmanSystemOptions {
  definitions: ShtickmanDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  plantedTrees?: PlantedTree[]; // Trees to patrol between
  onShtickmanKilled?: (tier: number) => void;
}

/**
 * Hook to manage active shtickmen with tree patrol behavior
 * Patrols between tier 5+ trees using A* pathfinding
 */
export function useShtickmanSystem({
  definitions,
  cameraRef,
  isEnabled,
  plantedTrees,
  onShtickmanKilled,
}: UseShtickmanSystemOptions) {
  const [shtickmen, setShtickmen] = useState<ShtickmanInstance[]>([]);
  const shtickmenRef = useRef<ShtickmanInstance[]>([]);

  // Cache of tier 5+ trees for patrol
  const patrolTreesRef = useRef<PlantedTree[]>([]);

  // Update patrol trees when plantedTrees changes
  // Only ordinary trees — shtickmen don't visit fungal or wide trees
  useEffect(() => {
    if (plantedTrees) {
      patrolTreesRef.current = plantedTrees.filter(
        tree =>
          (tree.seed_definition?.tier ?? 0) >= MIN_PATROL_TREE_TIER &&
          (tree.seed_definition?.tree_type === 'original' || !tree.seed_definition?.tree_type)
      );
    }
  }, [plantedTrees]);

  // Keep ref in sync
  useEffect(() => {
    shtickmenRef.current = shtickmen;
  }, [shtickmen]);

  /**
   * Get definition by tier
   */
  const getDefinitionByTier = useCallback((tier: number): ShtickmanDefinition | null => {
    const actualTier = tier === 0 ? 10 : tier;
    return definitions?.find(d => d.tier === actualTier) ?? null;
  }, [definitions]);

  /**
   * Pick a random patrol tree (different from current target)
   */
  const pickRandomPatrolTree = useCallback((currentTreeId: string | null): PlantedTree | null => {
    const trees = patrolTreesRef.current;
    if (trees.length === 0) return null;
    if (trees.length === 1) return trees[0];

    // Pick a random tree that's not the current one
    let attempts = 0;
    while (attempts < 10) {
      const idx = Math.floor(Math.random() * trees.length);
      if (trees[idx].id !== currentTreeId) {
        return trees[idx];
      }
      attempts++;
    }
    // Fallback to any tree
    return trees[Math.floor(Math.random() * trees.length)];
  }, []);

  /**
   * Spawn a shtickman at a specific world position
   */
  const spawnShtickmanAt = useCallback((
    definition: ShtickmanDefinition,
    worldX: number,
    worldZ: number,
  ): ShtickmanInstance | null => {
    if (shtickmenRef.current.length >= MAX_TOTAL_SHTICKMEN) {
      console.warn('[Shtickman] Max total shtickmen reached');
      return null;
    }

    const id = `shtickman_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Random scale variation ±10%
    const scale = 1 + (Math.random() * 2 - 1) * SHTICKMAN_SCALE_VARIATION;

    const instance: ShtickmanInstance = {
      id,
      definition,
      tier: definition.tier,
      position: new THREE.Vector3(worldX, 0, worldZ),
      rotationY: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      targetPos: new THREE.Vector3(worldX, 0, worldZ),
      targetTreeId: null,
      nextTargetAt: Date.now(), // Pick target immediately
      velocity: new THREE.Vector3(0, 0, 0),
      lastDamagedAt: 0,
      currentPath: null,
      currentPathIndex: 0,
      lastPathfindAt: Date.now() - Math.floor(Math.random() * PATHFIND_INTERVAL_MS),
      heightBlocks: getHeightBlocks(definition.tier),
      headSizeBlocks: getHeadSizeBlocks(definition.tier),
      animationPhase: Math.random() * Math.PI * 2,
      spawnedAt: Date.now(),
      scale,
      lastProximitySoundAt: 0,
      eyeState: {
        leftPupilOffset: { x: 0, y: 0 },
        rightPupilOffset: { x: 0, y: 0 },
        targetOffset: { x: 0, y: 0 },
        lastTargetChangeAt: Date.now(),
        isTrackingPlayer: false,
        trackedPlayerId: null,
      },
    };

    shtickmenRef.current = [...shtickmenRef.current, instance];
    setShtickmen(shtickmenRef.current);

    return instance;
  }, []);

  /**
   * Spawn a shtickman by tier near the player
   */
  const spawnShtickmanByTier = useCallback((tier: number) => {
    const definition = getDefinitionByTier(tier);
    if (!definition) {
      return null;
    }

    const camera = cameraRef.current;
    if (!camera) {
      return null;
    }

    // Spawn in front of player
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const spawnDist = SPAWN_MIN_DISTANCE + Math.random() * (SPAWN_MAX_DISTANCE - SPAWN_MIN_DISTANCE);
    const worldX = camera.position.x + forward.x * spawnDist + (Math.random() - 0.5) * 4;
    const worldZ = camera.position.z + forward.z * spawnDist + (Math.random() - 0.5) * 4;

    return spawnShtickmanAt(definition, worldX, worldZ);
  }, [cameraRef, definitions, getDefinitionByTier, spawnShtickmanAt]);

  /**
   * Ensure at least one shtickman exists
   */
  const ensureAtLeastOne = useCallback(() => {
    const activeCount = shtickmenRef.current.filter(s => s.isActive).length;
    if (activeCount === 0 && definitions && definitions.length > 0) {
      // Spawn tier 1 by default
      spawnShtickmanByTier(1);
    }
  }, [definitions, spawnShtickmanByTier]);

  /**
   * Damage a shtickman
   */
  const damageShtickman = useCallback((
    shtickmanId: string,
    damage: number,
    knockbackDir?: THREE.Vector3
  ): boolean => {
    const shtickman = shtickmenRef.current.find(s => s.id === shtickmanId);
    if (!shtickman || !shtickman.isActive) return false;

    shtickman.currentHealth -= damage;
    shtickman.lastDamagedAt = Date.now();

    if (knockbackDir) {
      const knockbackForce = shtickman.definition.knockback_received;
      shtickman.velocity.x += knockbackDir.x * knockbackForce;
      shtickman.velocity.z += knockbackDir.z * knockbackForce;
      shtickman.velocity.y += 2; // Small upward bounce
    }

    if (shtickman.currentHealth <= 0) {
      shtickman.isActive = false;

      // Play death sound if available
      if (shtickman.definition.death_sound_url) {
        const camera = cameraRef.current;
        if (camera) {
          const dx = shtickman.position.x - camera.position.x;
          const dy = shtickman.position.y - camera.position.y;
          const dz = shtickman.position.z - camera.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          playSpatialSound(shtickman.definition.death_sound_url, distance, { baseVolume: 0.7 });
        }
      }

      onShtickmanKilled?.(shtickman.definition.tier);

      // Remove from list
      shtickmenRef.current = shtickmenRef.current.filter(s => s.id !== shtickmanId);
      setShtickmen(shtickmenRef.current);

      return true;
    }

    setShtickmen([...shtickmenRef.current]);
    return false;
  }, [cameraRef, onShtickmanKilled]);

  /**
   * Clear all shtickmen
   */
  const clearAllShtickmen = useCallback(() => {
    shtickmenRef.current = [];
    setShtickmen([]);
  }, []);

  /**
   * Check if a position is blocked by collision
   */
  const isPositionBlocked = useCallback((x: number, z: number, radius: number, height: number): boolean => {
    const count = worldCollisionGrid.getNearbyFiltered(x, z, radius + 1, 0.1, height);
    const colliders = worldCollisionGrid.nearbyResult;

    for (let i = 0; i < count; i++) {
      const collider = colliders[i];
      // Simple AABB overlap check
      if (
        x + radius > collider.min.x &&
        x - radius < collider.max.x &&
        z + radius > collider.min.z &&
        z - radius < collider.max.z &&
        collider.min.y < height &&
        collider.max.y > 0.1
      ) {
        return true;
      }
    }
    return false;
  }, []);

  /**
   * Movement update - patrol between trees using pathfinding
   */
  const updateMovement = useCallback((deltaTime: number, _playerPosition: THREE.Vector3) => {
    const now = Date.now();

    for (const shtickman of shtickmenRef.current) {
      if (!shtickman.isActive) continue;

      const bodyHeight = shtickman.heightBlocks * shtickman.scale;
      const entityRadius = bodyHeight * 0.06; // Hip width ratio

      // Check if we need a new target tree
      if (now >= shtickman.nextTargetAt) {
        const targetTree = pickRandomPatrolTree(shtickman.targetTreeId);
        if (targetTree) {
          shtickman.targetTreeId = targetTree.id;
          shtickman.targetPos.set(targetTree.base_x, 0, targetTree.base_z);
          shtickman.currentPath = null; // Force pathfind
          shtickman.currentPathIndex = 0;
          shtickman.lastPathfindAt = 0;
        }
        // Set next target time far in future (will be reset when reaching tree)
        shtickman.nextTargetAt = now + 60000;
      }

      // Check if we've reached the target tree
      const distToTarget = Math.sqrt(
        Math.pow(shtickman.position.x - shtickman.targetPos.x, 2) +
        Math.pow(shtickman.position.z - shtickman.targetPos.z, 2)
      );

      if (distToTarget < TREE_TOUCH_DISTANCE) {
        // Reached tree! Wait then pick next
        shtickman.currentPath = null;
        shtickman.velocity.x *= 0.5;
        shtickman.velocity.z *= 0.5;
        shtickman.nextTargetAt = now + TREE_WAIT_TIME_MS;
        continue;
      }

      // Pathfinding: request path via Web Worker (async, non-blocking)
      // Entity continues on current path while waiting for new one
      if (
        !shtickman.currentPath ||
        now - shtickman.lastPathfindAt > PATHFIND_INTERVAL_MS
      ) {
        // Mark timestamp immediately to prevent re-requesting next frame
        shtickman.lastPathfindAt = now;

        const pathfindingConfig = shtickman.definition.pathfinding_config_code || 'astar_default';
        const capturedId = shtickman.id;
        // Increment request counter to detect stale out-of-order results
        const requestId = (shtickman as any)._pathfindRequestId = ((shtickman as any)._pathfindRequestId || 0) + 1;

        // Fire-and-forget async pathfind — result applied when it arrives
        pathfindingService.findPathAsync(
          pathfindingConfig,
          shtickman.position.x,
          shtickman.position.z,
          shtickman.targetPos.x,
          shtickman.targetPos.z,
          entityRadius,
          bodyHeight,
          0 // entityFeetY — ground level
        ).then(result => {
          // Find the shtickman by ID (it may have been removed while awaiting)
          const s = shtickmenRef.current.find(s => s.id === capturedId);
          if (!s || !s.isActive) return;
          // Discard stale result if a newer request was issued
          if ((s as any)._pathfindRequestId !== requestId) return;

          if (result.success && result.path && result.path.length > 0) {
            s.currentPath = result.path;
            s.currentPathIndex = 0;
          } else if (!s.currentPath) {
            // Only set fallback if no existing path
            s.currentPath = [s.targetPos.clone()];
            s.currentPathIndex = 0;
          }
        }).catch(() => {
          // Silently ignore — entity continues on current path
        });
      }

      // Follow current path
      let currentWaypoint: THREE.Vector3 | null = null;

      if (shtickman.currentPath && shtickman.currentPath.length > 0) {
        // Advance through waypoints we've reached
        while (
          shtickman.currentPathIndex < shtickman.currentPath.length - 1
        ) {
          const wp = shtickman.currentPath[shtickman.currentPathIndex];
          const distToWp = Math.sqrt(
            Math.pow(shtickman.position.x - wp.x, 2) +
            Math.pow(shtickman.position.z - wp.z, 2)
          );
          if (distToWp < WAYPOINT_REACH_DISTANCE) {
            shtickman.currentPathIndex++;
          } else {
            break;
          }
        }

        currentWaypoint = shtickman.currentPath[shtickman.currentPathIndex];
      }

      // Move toward waypoint or target
      const moveTarget = currentWaypoint || shtickman.targetPos;
      const dx = moveTarget.x - shtickman.position.x;
      const dz = moveTarget.z - shtickman.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.5) {
        const invDist = 1 / dist;
        const dirX = dx * invDist;
        const dirZ = dz * invDist;

        const speed = shtickman.definition.speed;

        // Check collision before moving
        const nextX = shtickman.position.x + dirX * speed * deltaTime;
        const nextZ = shtickman.position.z + dirZ * speed * deltaTime;

        const blocked = isPositionBlocked(nextX, nextZ, entityRadius, bodyHeight);

        if (!blocked) {
          shtickman.velocity.x = dirX * speed;
          shtickman.velocity.z = dirZ * speed;
        } else {
          // Try sliding along X or Z axis
          const blockedX = isPositionBlocked(nextX, shtickman.position.z, entityRadius, bodyHeight);
          const blockedZ = isPositionBlocked(shtickman.position.x, nextZ, entityRadius, bodyHeight);

          if (!blockedX) {
            shtickman.velocity.x = dirX * speed;
            shtickman.velocity.z = 0;
          } else if (!blockedZ) {
            shtickman.velocity.x = 0;
            shtickman.velocity.z = dirZ * speed;
          } else {
            // Try diagonal slides (perpendicular to movement direction)
            const perpX = -dirZ;
            const perpZ = dirX;
            const slideSpeed = speed * 0.7;

            // Try sliding left
            const slideLeftX = shtickman.position.x + perpX * slideSpeed * deltaTime;
            const slideLeftZ = shtickman.position.z + perpZ * slideSpeed * deltaTime;
            const blockedLeft = isPositionBlocked(slideLeftX, slideLeftZ, entityRadius, bodyHeight);

            // Try sliding right
            const slideRightX = shtickman.position.x - perpX * slideSpeed * deltaTime;
            const slideRightZ = shtickman.position.z - perpZ * slideSpeed * deltaTime;
            const blockedRight = isPositionBlocked(slideRightX, slideRightZ, entityRadius, bodyHeight);

            if (!blockedLeft) {
              shtickman.velocity.x = perpX * slideSpeed;
              shtickman.velocity.z = perpZ * slideSpeed;
            } else if (!blockedRight) {
              shtickman.velocity.x = -perpX * slideSpeed;
              shtickman.velocity.z = -perpZ * slideSpeed;
            } else {
              // Fully blocked, slow down
              shtickman.velocity.x *= 0.3;
              shtickman.velocity.z *= 0.3;
              // Force re-pathfind immediately
              shtickman.lastPathfindAt = 0;
            }
          }
        }

        // Face the movement direction
        if (Math.abs(shtickman.velocity.x) > 0.1 || Math.abs(shtickman.velocity.z) > 0.1) {
          shtickman.rotationY = Math.atan2(shtickman.velocity.x, shtickman.velocity.z);
        }
      } else {
        // Near target, slow down
        shtickman.velocity.x *= 0.8;
        shtickman.velocity.z *= 0.8;
      }

      // Apply gravity
      if (shtickman.position.y > 0) {
        shtickman.velocity.y -= SHTICKMAN_GRAVITY * deltaTime;
      } else {
        shtickman.velocity.y = 0;
        shtickman.position.y = 0;
      }

      // Apply velocity to position
      shtickman.position.x += shtickman.velocity.x * deltaTime;
      shtickman.position.y += shtickman.velocity.y * deltaTime;
      shtickman.position.z += shtickman.velocity.z * deltaTime;

      // Clamp to ground
      if (shtickman.position.y < 0) {
        shtickman.position.y = 0;
        shtickman.velocity.y = 0;
      }

      // Update animation phase at fixed rate (decoupled from movement speed)
      // Animation speed reduced by 75% to match walking speed better
      const animationSpeed = 1.5;
      const cycleDistance = bodyHeight * 0.30;
      const movementSpeed = Math.sqrt(
        shtickman.velocity.x * shtickman.velocity.x +
        shtickman.velocity.z * shtickman.velocity.z
      );
      if (movementSpeed > 0.1) {
        shtickman.animationPhase += (animationSpeed / cycleDistance) * Math.PI * 2 * deltaTime;
      }
    }
  }, [pickRandomPatrolTree, isPositionBlocked]);

  /**
   * Roar sounds - occasional ambient sounds
   */
  useEffect(() => {
    if (!isEnabled) return;

    const roarCheck = () => {
      const camera = cameraRef.current;
      if (!camera) return;
      if (shtickmenRef.current.length === 0) return;

      for (const shtickman of shtickmenRef.current) {
        if (!shtickman.isActive) continue;
        if (!shtickman.definition.roar_sound_url) continue;

        // 10% chance per shtickman
        if (Math.random() < ROAR_CHANCE) {
          const dx = shtickman.position.x - camera.position.x;
          const dy = shtickman.position.y - camera.position.y;
          const dz = shtickman.position.z - camera.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          playSpatialSound(shtickman.definition.roar_sound_url, distance, { baseVolume: ROAR_VOLUME });
        }
      }
    };

    const interval = setInterval(roarCheck, ROAR_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled, cameraRef]);

  /**
   * Proximity sounds - plays when shtickman gets within one chunk of player
   */
  useEffect(() => {
    if (!isEnabled) return;

    const proximityCheck = () => {
      const camera = cameraRef.current;
      if (!camera) return;
      if (shtickmenRef.current.length === 0) return;

      const now = Date.now();

      for (const shtickman of shtickmenRef.current) {
        if (!shtickman.isActive) continue;

        // Calculate distance to player
        const dx = shtickman.position.x - camera.position.x;
        const dz = shtickman.position.z - camera.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Check if within proximity distance (one chunk)
        if (distance < PROXIMITY_SOUND_DISTANCE) {
          // Check cooldown
          if (now - shtickman.lastProximitySoundAt >= PROXIMITY_SOUND_COOLDOWN_MS) {
            // Use custom sound URL or default
            const soundUrl = shtickman.definition.proximity_sound_url || DEFAULT_PROXIMITY_SOUND_URL;

            playSpatialSound(soundUrl, distance, { baseVolume: PROXIMITY_SOUND_VOLUME });
            shtickman.lastProximitySoundAt = now;
          }
        }
      }
    };

    // Check more frequently than roars since this is distance-based
    const interval = setInterval(proximityCheck, 500);
    return () => clearInterval(interval);
  }, [isEnabled, cameraRef]);

  /**
   * Ensure at least one shtickman exists
   */
  useEffect(() => {
    if (!isEnabled || !definitions || definitions.length === 0) return;

    const interval = setInterval(ensureAtLeastOne, EXISTENCE_CHECK_INTERVAL_MS);
    // Also check immediately
    ensureAtLeastOne();

    return () => clearInterval(interval);
  }, [isEnabled, definitions, ensureAtLeastOne]);

  // EnemyCombatRegistry adapter — every weapon (bullet, flame, future)
  // can target shtickmen without per-type code in the weapon.
  useEffect(() => {
    // Reused per hit — avoids allocating a Vector3 every bullet impact.
    const dirScratch = new THREE.Vector3();
    return enemyCombatRegistry.register({
      type: 'shtickman',
      getActiveEnemies: () => shtickmenRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive) return null;
        const scale = s.scale ?? 1;
        const height = (s.heightBlocks ?? 22) * scale;
        return {
          centerX: s.position.x,
          centerZ: s.position.z,
          bottomY: s.position.y,
          topY: s.position.y + height,
          radius: SHTICKMAN_HITBOX_RADIUS * scale,
        };
      },
      applyDamage: (s, info) => {
        dirScratch.set(info.knockbackDirX, 0, info.knockbackDirZ);
        return damageShtickman(s.id, info.damage, dirScratch);
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
      // Shtickman head is small relative to its 22-40m body — match
      // the legacy 15% upper-zone rule.
      getHeadshotZoneFraction: () => 0.15,
    });
  }, [damageShtickman]);

  return {
    shtickmen,
    shtickmenRef,
    spawnShtickmanAt,
    spawnShtickmanByTier,
    getDefinitionByTier,
    damageShtickman,
    clearAllShtickmen,
    updateMovement,
  };
}
