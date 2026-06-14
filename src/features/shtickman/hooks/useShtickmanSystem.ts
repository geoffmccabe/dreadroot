import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { ShtickmanDefinition, ShtickmanInstance } from '../types';
import { getHeightBlocks, getHeadSizeBlocks } from '../types';
import {
  MAX_TOTAL_SHTICKMEN,
  SPAWN_MIN_DISTANCE,
  SPAWN_MAX_DISTANCE,
  EXISTENCE_CHECK_INTERVAL_MS,
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
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import { SHTICKMAN_HITBOX_RADIUS } from '../constants';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import type { PlantedTree } from '@/features/trees/types';
import { stepShtickmanAI } from '../ai/shtickmanTree';
import { type ShtickmanStepDeps, PATHFIND_INTERVAL_MS } from '../lib/patrolAI';

// Minimum tree tier for patrol targets
const MIN_PATROL_TREE_TIER = 5;

// "Got mad" shake reaction when shot: shake around the hit pose for this long.
const SHTICKMAN_MAD_MS = 1200;

// Shtickmen are heavier-footed: blasts (grenades) move them only this fraction
// of what other creatures take.
const SHTICKMAN_BLAST_KB_FRACTION = 0.25;

interface UseShtickmanSystemOptions {
  definitions: ShtickmanDefinition[] | undefined;
  cameraRef: React.RefObject<THREE.Camera>;
  isEnabled: boolean;
  plantedTrees?: PlantedTree[]; // Trees to patrol between
  onShtickmanKilled?: (tier: number, x: number, y: number, z: number) => void;
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
      const want = tier === 0 ? 10 : tier;
      console.warn(`[Shtickman] No definition for tier ${want} (have tiers: ${(definitions ?? []).map(d => d.tier).join(', ') || 'none'}) — spawn skipped`);
      return null;
    }

    // Spawn in front of player using snapshot yaw.
    const p = getLocalPlayerSnapshot();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const spawnDist = SPAWN_MIN_DISTANCE + Math.random() * (SPAWN_MAX_DISTANCE - SPAWN_MIN_DISTANCE);
    const worldX = p.x + fx * spawnDist + (Math.random() - 0.5) * 4;
    const worldZ = p.z + fz * spawnDist + (Math.random() - 0.5) * 4;

    return spawnShtickmanAt(definition, worldX, worldZ);
  }, [definitions, getDefinitionByTier, spawnShtickmanAt]);

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
    knockbackDir?: THREE.Vector3,
    /** Override the per-tier knockback_received multiplier. Grenades
     *  pass their blast magnitude directly so explosions actually
     *  punt; bullets leave this undefined and use the per-tier value. */
    kbOverride?: number,
  ): boolean => {
    const shtickman = shtickmenRef.current.find(s => s.id === shtickmanId);
    if (!shtickman || !shtickman.isActive) return false;

    shtickman.currentHealth -= damage;
    shtickman.lastDamagedAt = Date.now();

    if (knockbackDir) {
      const knockbackForce = kbOverride ?? shtickman.definition.knockback_received;
      shtickman.velocity.x += knockbackDir.x * knockbackForce;
      shtickman.velocity.z += knockbackDir.z * knockbackForce;
      // Y comes from the knockback direction (blast 0–45° tilt). Falls
      // back to the legacy small bounce if Y is zero (bullet hits).
      if (knockbackDir.y > 0) {
        shtickman.velocity.y += knockbackDir.y * knockbackForce;
      } else {
        shtickman.velocity.y += 2;
      }
      // Open a knockback window so the walk doesn't immediately overwrite the
      // impulse — the shtickman is flung + decelerates over this window, then
      // resumes patrolling. (Fixes "grenade blasts don't affect shtickmen".)
      shtickman.knockbackUntil = Date.now() + 500;
      // A blast overrides any in-progress "got mad" shake; clear it so the
      // shake's restore-to-base doesn't yank the shtickman back after the fling.
      shtickman.madUntil = undefined;
    }

    if (shtickman.currentHealth <= 0) {
      shtickman.isActive = false;

      // Play death sound if available
      if (shtickman.definition.death_sound_url) {
        const p = getLocalPlayerSnapshot();
        const dx = shtickman.position.x - p.x;
        const dy = shtickman.position.y - p.y;
        const dz = shtickman.position.z - p.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        playSpatialSound(shtickman.definition.death_sound_url, distance, { baseVolume: 0.7 });
      }

      onShtickmanKilled?.(shtickman.definition.tier, shtickman.position.x, shtickman.position.y, shtickman.position.z);

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
    // Build the shared per-frame deps once; every shtickman steps on the same
    // behavior-tree runtime (ai/shtickmanTree). The decision logic + execution
    // live in lib/patrolAI; the hook just supplies the game services + loops.
    const deps: ShtickmanStepDeps = {
      now: Date.now(),
      deltaTime,
      shtickmenRef,
      pickRandomPatrolTree,
      isPositionBlocked,
    };
    for (const shtickman of shtickmenRef.current) {
      if (!shtickman.isActive) continue;
      stepShtickmanAI(shtickman, deps);
    }
  }, [pickRandomPatrolTree, isPositionBlocked]);

  /**
   * Roar sounds - occasional ambient sounds
   */
  useEffect(() => {
    if (!isEnabled) return;

    const roarCheck = () => {
      if (shtickmenRef.current.length === 0) return;
      const p = getLocalPlayerSnapshot();

      for (const shtickman of shtickmenRef.current) {
        if (!shtickman.isActive) continue;
        if (!shtickman.definition.roar_sound_url) continue;
        if (Math.random() < ROAR_CHANCE) {
          const dx = shtickman.position.x - p.x;
          const dy = shtickman.position.y - p.y;
          const dz = shtickman.position.z - p.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          playSpatialSound(shtickman.definition.roar_sound_url, distance, { baseVolume: ROAR_VOLUME });
        }
      }
    };

    const interval = setInterval(roarCheck, ROAR_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled]);

  /**
   * Proximity sounds - plays when shtickman gets within one chunk of player
   */
  useEffect(() => {
    if (!isEnabled) return;

    const proximityCheck = () => {
      if (shtickmenRef.current.length === 0) return;
      const p = getLocalPlayerSnapshot();
      const now = Date.now();

      for (const shtickman of shtickmenRef.current) {
        if (!shtickman.isActive) continue;
        const dx = shtickman.position.x - p.x;
        const dz = shtickman.position.z - p.z;
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
      petAttackable: false,
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
        // SHOT (bullet) → take damage (can die). No bullet knockback — if it
        // survives, the reaction is the "get mad" shake in place. Capture the
        // base pose only when a new mad period starts (repeated hits don't drift
        // the shake origin).
        if (info.source === 'bullet') {
          const killed = damageShtickman(s.id, info.damage);
          if (!killed && s.isActive) {
            const now = Date.now();
            if (!s.madUntil || now >= s.madUntil) {
              s.madBaseX = s.position.x;
              s.madBaseZ = s.position.z;
              s.madBaseRot = s.rotationY;
            }
            s.madUntil = now + SHTICKMAN_MAD_MS;
          }
          return killed;
        }
        // Explosion/flame: damage + knockback. Blasts move shtickmen only 25% as
        // much as other creatures (they're heavier-footed).
        dirScratch.set(info.knockbackDirX, info.knockbackDirY ?? 0, info.knockbackDirZ);
        const kbOverride = info.source === 'explosion'
          ? (info.bulletSpeed ? info.bulletSpeed * SHTICKMAN_BLAST_KB_FRACTION : undefined)
          : undefined;
        return damageShtickman(s.id, info.damage, dirScratch, kbOverride);
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
