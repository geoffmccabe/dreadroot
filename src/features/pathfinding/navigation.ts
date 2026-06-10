/**
 * navigation (Slice 4b core) — turns a planner into smooth, cheap "follow a path
 * to a moving target" behavior. The expensive plan (A*) is recomputed only on a
 * BUDGET (every `replanMs`), when the goal jumps far, or when the path runs out;
 * in between, the creature just walks the cached waypoints. This is what keeps
 * pathfinding affordable at horde scale.
 *
 * PURE: works over the abstract PathGrid, so it's unit-testable with a mock grid
 * and has no game/THREE coupling. The grid ADAPTER (real voxel world) and the
 * chase hook are wired on top of this.
 */
import type { PathGrid, PathPlanner, PathPoint } from './planners';

export interface NavState {
  path: PathPoint[];
  index: number;
  lastPlanMs: number;
  goalX: number;
  goalZ: number;
}

export function makeNavState(): NavState {
  return { path: [], index: 0, lastPlanMs: -Infinity, goalX: NaN, goalZ: NaN };
}

/** How far (cells, Manhattan) the goal can jump before we force a replan. */
const GOAL_JUMP_CELLS = 4;

/**
 * Next cell to move toward, heading from (fromX,fromZ) to (toX,toZ). Mutates
 * `state` (cached path + progress) — hold one per creature and reuse it.
 */
export function navigate(
  state: NavState,
  planner: PathPlanner,
  grid: PathGrid,
  fromX: number, fromZ: number,
  toX: number, toZ: number,
  nowMs: number,
  replanMs = 500,
): PathPoint {
  const fcx = Math.round(fromX), fcz = Math.round(fromZ);
  const gcx = Math.round(toX), gcz = Math.round(toZ);

  const budgetElapsed = nowMs - state.lastPlanMs >= replanMs;
  const goalJumped = Math.abs(gcx - state.goalX) + Math.abs(gcz - state.goalZ) > GOAL_JUMP_CELLS;
  const pathDone = state.index >= state.path.length;

  if (state.lastPlanMs === -Infinity || budgetElapsed || goalJumped || pathDone) {
    state.path = planner(fcx, fcz, gcx, gcz, grid);
    state.index = 0;
    state.lastPlanMs = nowMs;
    state.goalX = gcx;
    state.goalZ = gcz;
  }

  // Drop waypoints already reached (creature's cell == waypoint cell).
  while (state.index < state.path.length - 1) {
    const wp = state.path[state.index];
    if (fcx === wp.x && fcz === wp.z) state.index++;
    else break;
  }

  return state.path[state.index] ?? { x: gcx, z: gcz };
}
