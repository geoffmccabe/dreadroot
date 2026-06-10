/**
 * pathfinding registry — maps an algorithm code (the `algorithm_code` stored on
 * a pathfinding preset in the DB / chosen in the admin panel) to its planner
 * implementation. A creature's movement action looks up its preset's code here.
 *
 * Unknown codes fall back to `direct` (always safe), so a misconfigured or
 * not-yet-implemented preset degrades gracefully rather than breaking movement.
 */
import { directPlan, aStarPlan, type PathPlanner } from './planners';

export const PATH_PLANNERS: Record<string, PathPlanner> = {
  direct: directPlan,
  astar: aStarPlan,
};

/** Human-facing list (for the admin algorithm dropdown), kept in sync with the
 *  implementations above. */
export const PATH_ALGORITHMS: { code: string; name: string }[] = [
  { code: 'direct', name: 'Direct (straight line)' },
  { code: 'astar', name: 'A* (navigate around obstacles)' },
];

/** Resolve a code to a planner; unknown/empty → direct. */
export function resolvePlanner(code: string | null | undefined): PathPlanner {
  return (code && PATH_PLANNERS[code]) || directPlan;
}
