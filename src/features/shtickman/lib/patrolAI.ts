/**
 * Shtickman patrol AI — Phase 1.2 of the master plan.
 *
 * The shtickman's "mad-shake OR patrol-between-trees" behavior, extracted out of
 * the hook's per-frame loop into free phase functions so BOTH the legacy
 * orchestrator (below) AND the behavior tree (ai/shtickmanTree) drive the SAME
 * code in the SAME order — behavior is identical; the BT is pure re-orchestration.
 *
 * The game services the decision needs (tree picking, collision testing, the
 * async pathfinder, the live instance list) are passed in via `deps` rather than
 * hard-imported, which keeps this portable for the eventual server move — the
 * server supplies its own equivalents.
 */
import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import type { ShtickmanInstance } from '../types';
import type { PlantedTree } from '@/features/trees/types';
import { pathfindingService } from '@/lib/pathfinding';
import { SHTICKMAN_GRAVITY } from '../constants';

// Patrol/shake constants — single home (the spawn fn imports PATHFIND_INTERVAL_MS).
export const PATHFIND_INTERVAL_MS = 1500; // how often to recalculate the path
export const PATHFIND_HORIZON = 100;      // local-search horizon toward a distant tree
export const WAYPOINT_REACH_DISTANCE = 3.0;
export const TREE_TOUCH_DISTANCE = 5.0;   // close enough to count as "touched"
export const TREE_WAIT_TIME_MS = 2000;    // pause at a tree before picking the next
export const SHTICKMAN_SHAKE_POS = 0.5;   // mad horizontal jitter (blocks)
export const SHTICKMAN_SHAKE_ROT = 0.35;  // mad twist jitter (radians)

/** Per-frame deps shared across all shtickmen (built once per update call). */
export interface ShtickmanStepDeps {
  now: number;
  deltaTime: number;
  shtickmenRef: MutableRefObject<ShtickmanInstance[]>;
  pickRandomPatrolTree: (currentTreeId: string | null) => PlantedTree | null;
  isPositionBlocked: (x: number, z: number, radius: number, height: number) => boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase functions — execution, split out so the FSM and the BT share one source.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mad-expiry cleanup (pre-step): when the shake timer passes, restore the pose
 * captured at hit time and clear the flag. Runs before the tree, so an expired
 * shtickman both restores AND walks the same tick (matching the legacy loop).
 */
export function madExpiryCleanup(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  if (s.madUntil && deps.now >= s.madUntil) {
    if (s.madBaseX !== undefined) s.position.x = s.madBaseX;
    if (s.madBaseZ !== undefined) s.position.z = s.madBaseZ;
    if (s.madBaseRot !== undefined) s.rotationY = s.madBaseRot;
    s.madUntil = undefined;
  }
}

/**
 * Blast knockback (pre-step): while the knockback window is open, fling the
 * shtickman by its (decaying) velocity + gravity and skip the walk, so a grenade
 * push actually displaces it instead of being overwritten by the next walk
 * frame. Returns true while active. (Fixes "blasts don't affect shtickmen".)
 */
export function applyKnockbackDecay(s: ShtickmanInstance, deps: ShtickmanStepDeps): boolean {
  if (!s.knockbackUntil || deps.now >= s.knockbackUntil) return false;
  const dt = deps.deltaTime;
  if (s.position.y > 0) s.velocity.y -= SHTICKMAN_GRAVITY * dt; // blast tilt launches it up
  s.position.x += s.velocity.x * dt;
  s.position.y += s.velocity.y * dt;
  s.position.z += s.velocity.z * dt;
  if (s.position.y < 0) {
    s.position.y = 0;
    s.velocity.y = 0;
  }
  // Decay the horizontal fling (halflife ~0.18s) so it eases to a stop.
  const decay = Math.pow(0.5, dt * 4);
  s.velocity.x *= decay;
  s.velocity.z *= decay;
  return true;
}

/** Still-mad shake: jitter position + twist around the captured base pose. */
export function shakeMad(s: ShtickmanInstance): void {
  s.position.x = (s.madBaseX ?? s.position.x) + (Math.random() - 0.5) * SHTICKMAN_SHAKE_POS;
  s.position.z = (s.madBaseZ ?? s.position.z) + (Math.random() - 0.5) * SHTICKMAN_SHAKE_POS;
  s.rotationY = (s.madBaseRot ?? s.rotationY) + (Math.random() - 0.5) * SHTICKMAN_SHAKE_ROT;
}

/** Pick a new patrol target tree if the per-target timer is due. */
export function maybePickTarget(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  const { now } = deps;
  if (now >= s.nextTargetAt) {
    const targetTree = deps.pickRandomPatrolTree(s.targetTreeId);
    if (targetTree) {
      s.targetTreeId = targetTree.id;
      s.targetPos.set(targetTree.base_x, 0, targetTree.base_z);
      s.currentPath = null; // force pathfind
      s.currentPathIndex = 0;
      s.lastPathfindAt = 0;
    }
    // Far future; reset to now+wait when the tree is reached.
    s.nextTargetAt = now + 60000;
  }
}

/** True if within touch distance of the target tree. */
export function reachedTree(s: ShtickmanInstance): boolean {
  const dx = s.position.x - s.targetPos.x;
  const dz = s.position.z - s.targetPos.z;
  return Math.sqrt(dx * dx + dz * dz) < TREE_TOUCH_DISTANCE;
}

/** Arrived at a tree: drop the path, slow, schedule the next target after a wait. */
export function arriveAndWait(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  s.currentPath = null;
  s.velocity.x *= 0.5;
  s.velocity.z *= 0.5;
  s.nextTargetAt = deps.now + TREE_WAIT_TIME_MS;
}

/**
 * Patrol walk: async re-path (fire-and-forget A*), follow waypoints, collision-
 * slide movement, gravity, ground clamp, animation phase. The full walk as one
 * unit — the collision-slide is load-bearing for not clipping into trees.
 */
export function patrolWalk(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  const { now, deltaTime, isPositionBlocked, shtickmenRef } = deps;
  const bodyHeight = s.heightBlocks * s.scale;
  const entityRadius = bodyHeight * 0.06; // hip width ratio

  // ── Re-path via Web Worker (async, non-blocking). Entity keeps its current
  //    path while waiting; stale out-of-order results are discarded by id.
  if (!s.currentPath || now - s.lastPathfindAt > PATHFIND_INTERVAL_MS) {
    s.lastPathfindAt = now;
    const pathfindingConfig = s.definition.pathfinding_config_code || 'astar_default';
    const capturedId = s.id;
    const requestId = (s as any)._pathfindRequestId = ((s as any)._pathfindRequestId || 0) + 1;

    // Local-horizon goal: clamp the target PATHFIND_HORIZON blocks toward the
    // distant tree so each A* search stays small + actually succeeds.
    let goalX = s.targetPos.x;
    let goalZ = s.targetPos.z;
    const gdx = goalX - s.position.x;
    const gdz = goalZ - s.position.z;
    const gdist = Math.sqrt(gdx * gdx + gdz * gdz);
    if (gdist > PATHFIND_HORIZON) {
      goalX = s.position.x + (gdx / gdist) * PATHFIND_HORIZON;
      goalZ = s.position.z + (gdz / gdist) * PATHFIND_HORIZON;
    }

    pathfindingService.findPathAsync(
      pathfindingConfig,
      s.position.x,
      s.position.z,
      goalX,
      goalZ,
      entityRadius,
      bodyHeight,
      0, // entityFeetY — ground level
    ).then(result => {
      const sx = shtickmenRef.current.find(x => x.id === capturedId);
      if (!sx || !sx.isActive) return;
      if ((sx as any)._pathfindRequestId !== requestId) return; // stale
      if (result.success && result.path && result.path.length > 0) {
        sx.currentPath = result.path;
        sx.currentPathIndex = 0;
      } else if (!sx.currentPath) {
        sx.currentPath = [sx.targetPos.clone()];
        sx.currentPathIndex = 0;
      }
    }).catch(() => {
      // Silently ignore — entity continues on current path.
    });
  }

  // ── Follow current path: advance through reached waypoints.
  let currentWaypoint: THREE.Vector3 | null = null;
  if (s.currentPath && s.currentPath.length > 0) {
    while (s.currentPathIndex < s.currentPath.length - 1) {
      const wp = s.currentPath[s.currentPathIndex];
      const distToWp = Math.sqrt(
        Math.pow(s.position.x - wp.x, 2) +
        Math.pow(s.position.z - wp.z, 2),
      );
      if (distToWp < WAYPOINT_REACH_DISTANCE) s.currentPathIndex++;
      else break;
    }
    currentWaypoint = s.currentPath[s.currentPathIndex];
  }

  // ── Move toward the waypoint/target with collision sliding.
  const moveTarget = currentWaypoint || s.targetPos;
  const dx = moveTarget.x - s.position.x;
  const dz = moveTarget.z - s.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 0.5) {
    const invDist = 1 / dist;
    const dirX = dx * invDist;
    const dirZ = dz * invDist;
    const speed = s.definition.speed;

    const nextX = s.position.x + dirX * speed * deltaTime;
    const nextZ = s.position.z + dirZ * speed * deltaTime;
    const blocked = isPositionBlocked(nextX, nextZ, entityRadius, bodyHeight);

    if (!blocked) {
      s.velocity.x = dirX * speed;
      s.velocity.z = dirZ * speed;
    } else {
      // Slide along X or Z.
      const blockedX = isPositionBlocked(nextX, s.position.z, entityRadius, bodyHeight);
      const blockedZ = isPositionBlocked(s.position.x, nextZ, entityRadius, bodyHeight);
      if (!blockedX) {
        s.velocity.x = dirX * speed;
        s.velocity.z = 0;
      } else if (!blockedZ) {
        s.velocity.x = 0;
        s.velocity.z = dirZ * speed;
      } else {
        // Slide perpendicular (left/right), else stall + force re-path.
        const perpX = -dirZ;
        const perpZ = dirX;
        const slideSpeed = speed * 0.7;

        const slideLeftX = s.position.x + perpX * slideSpeed * deltaTime;
        const slideLeftZ = s.position.z + perpZ * slideSpeed * deltaTime;
        const blockedLeft = isPositionBlocked(slideLeftX, slideLeftZ, entityRadius, bodyHeight);

        const slideRightX = s.position.x - perpX * slideSpeed * deltaTime;
        const slideRightZ = s.position.z - perpZ * slideSpeed * deltaTime;
        const blockedRight = isPositionBlocked(slideRightX, slideRightZ, entityRadius, bodyHeight);

        if (!blockedLeft) {
          s.velocity.x = perpX * slideSpeed;
          s.velocity.z = perpZ * slideSpeed;
        } else if (!blockedRight) {
          s.velocity.x = -perpX * slideSpeed;
          s.velocity.z = -perpZ * slideSpeed;
        } else {
          s.velocity.x *= 0.3;
          s.velocity.z *= 0.3;
          s.lastPathfindAt = 0; // force immediate re-path
        }
      }
    }

    // Face the movement direction.
    if (Math.abs(s.velocity.x) > 0.1 || Math.abs(s.velocity.z) > 0.1) {
      s.rotationY = Math.atan2(s.velocity.x, s.velocity.z);
    }
  } else {
    // Near target, slow down.
    s.velocity.x *= 0.8;
    s.velocity.z *= 0.8;
  }

  // ── Gravity + integrate + ground clamp.
  if (s.position.y > 0) {
    s.velocity.y -= SHTICKMAN_GRAVITY * deltaTime;
  } else {
    s.velocity.y = 0;
    s.position.y = 0;
  }
  s.position.x += s.velocity.x * deltaTime;
  s.position.y += s.velocity.y * deltaTime;
  s.position.z += s.velocity.z * deltaTime;
  if (s.position.y < 0) {
    s.position.y = 0;
    s.velocity.y = 0;
  }

  // ── Animation phase (fixed rate, decoupled from movement speed).
  const animationSpeed = 1.5;
  const cycleDistance = bodyHeight * 0.30;
  const movementSpeed = Math.sqrt(
    s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z,
  );
  if (movementSpeed > 0.1) {
    s.animationPhase += (animationSpeed / cycleDistance) * Math.PI * 2 * deltaTime;
  }
}

/**
 * LEGACY per-shtickman orchestrator (fallback path). Same order as the original
 * loop body; the BT in ai/shtickmanTree.ts drives these SAME functions in the
 * SAME priority, so the two are behaviorally identical.
 */
export function stepShtickmanLegacy(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  if (applyKnockbackDecay(s, deps)) return; // flung by a blast — skip mad + walk
  if (s.madUntil) {
    if (deps.now < s.madUntil) {
      shakeMad(s);
      return;
    }
    madExpiryCleanup(s, deps); // expired → restore pose + clear, fall through
  }
  maybePickTarget(s, deps);
  if (reachedTree(s)) {
    arriveAndWait(s, deps);
    return;
  }
  patrolWalk(s, deps);
}
