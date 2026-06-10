// Tests the pathfinding planners + registry (Slice 4a). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-pathfinding.ts
import { directPlan, aStarPlan, type PathGrid } from '../src/features/pathfinding/planners.ts';
import { resolvePlanner } from '../src/features/pathfinding/registry.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const last = <T>(a: T[]) => a[a.length - 1];

const openGrid: PathGrid = { isBlocked: () => false };

// 1. direct → straight at the target.
const d = directPlan(0, 0, 5, 2, openGrid);
assert(d.length === 1 && d[0].x === 5 && d[0].z === 2, 'direct heads straight to target');

// 2. A* in the open reaches the goal with no blocked cells.
const s = aStarPlan(0, 0, 3, 0, openGrid);
assert(last(s).x === 3 && last(s).z === 0, 'astar open reaches goal');
assert(!s.some((p) => openGrid.isBlocked(p.x, p.z)), 'astar open path is clear');

// 3. A* routes AROUND a wall (x=2, z in [-1,1]) blocking the straight line.
const wall: PathGrid = { isBlocked: (x, z) => x === 2 && z >= -1 && z <= 1 };
const w = aStarPlan(0, 0, 4, 0, wall);
assert(last(w).x === 4 && last(w).z === 0, 'astar-wall reaches goal');
assert(!w.some((p) => wall.isBlocked(p.x, p.z)), 'astar-wall path avoids the wall');
assert(w.some((p) => Math.abs(p.z) >= 2), 'astar-wall actually detours around it');

// 4. No reachable path → fall back to heading straight (safe).
const boxedGoal: PathGrid = {
  isBlocked: (x, z) => (x === 3 && z === 0) || (x === 5 && z === 0) || (x === 4 && z === 1) || (x === 4 && z === -1),
};
const np = aStarPlan(0, 0, 4, 0, boxedGoal);
assert(np.length === 1 && last(np).x === 4 && last(np).z === 0, 'astar no-path → direct fallback');

// 5. Search cap hit (far goal, tiny budget) → direct fallback.
const far = aStarPlan(0, 0, 100, 100, openGrid, 5);
assert(far.length === 1 && last(far).x === 100 && last(far).z === 100, 'astar capped → direct fallback');

// 6. Registry resolves codes; unknown/empty → direct.
assert(resolvePlanner('direct') === directPlan, 'registry: direct');
assert(resolvePlanner('astar') === aStarPlan, 'registry: astar');
assert(resolvePlanner('nope') === directPlan, 'registry: unknown → direct');
assert(resolvePlanner(null) === directPlan, 'registry: null → direct');

if (failures === 0) {
  console.log('✅ pathfinding OK (direct / astar reach / astar around wall / no-path + cap fallback / registry)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} pathfinding failure(s)`);
  process.exit(1);
}
