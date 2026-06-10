/**
 * pathfinding planners (Slice 4a) — the actual "how does a creature get from A
 * to B" algorithms, as PURE logic over an abstract grid. The grid adapter that
 * queries the real voxel world is wired in Slice 4b; here the grid is just an
 * `isBlocked(x,z)` interface, so this is fully unit-testable and portable.
 *
 * A planner returns the WAYPOINTS to move toward (in grid-cell coords), NOT
 * including the creature's current cell. The movement layer heads for waypoint
 * [0] and advances as it reaches each.
 */

export interface PathPoint { x: number; z: number; }

/** The world as the planner sees it: which horizontal cells are impassable. */
export interface PathGrid {
  isBlocked(cellX: number, cellZ: number): boolean;
}

export type PathPlanner = (
  fromX: number, fromZ: number, toX: number, toZ: number,
  grid: PathGrid, maxNodes?: number,
) => PathPoint[];

/** direct — head straight for the target and let collision/separation sort out
 *  the rest. Cheapest; reproduces today's behavior. */
export const directPlan: PathPlanner = (_fx, _fz, toX, toZ) => {
  return [{ x: Math.round(toX), z: Math.round(toZ) }];
};

/**
 * aStar — 4-directional A* over the walkable cells: navigates AROUND obstacles
 * instead of pushing into them. Capped at `maxNodes` so a hopeless/huge search
 * can't stall the tick; on no-path-or-cap it falls back to heading straight
 * (direct), which is always safe. (Open set is a linear min-scan — fine within
 * the cap; a heap is a Slice-4b optimization if big searches ever matter.)
 */
export const aStarPlan: PathPlanner = (fromX, fromZ, toX, toZ, grid, maxNodes = 400) => {
  const sx = Math.round(fromX), sz = Math.round(fromZ);
  const gx = Math.round(toX), gz = Math.round(toZ);
  if (sx === gx && sz === gz) return [{ x: gx, z: gz }];

  const k = (x: number, z: number) => `${x},${z}`;
  const open = new Map<string, { x: number; z: number; g: number; f: number }>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const h = (x: number, z: number) => Math.abs(x - gx) + Math.abs(z - gz);

  const startK = k(sx, sz);
  open.set(startK, { x: sx, z: sz, g: 0, f: h(sx, sz) });
  gScore.set(startK, 0);

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let nodes = 0;

  while (open.size > 0 && nodes < maxNodes) {
    nodes++;
    // Pick the open cell with the lowest f.
    let curK = '', cur: { x: number; z: number; g: number; f: number } | null = null, bestF = Infinity;
    for (const [kk, n] of open) { if (n.f < bestF) { bestF = n.f; cur = n; curK = kk; } }
    if (!cur) break;

    if (cur.x === gx && cur.z === gz) {
      // Reconstruct goal→start from the cell keys, reverse, drop the start cell.
      const full: PathPoint[] = [];
      let ck: string | undefined = curK;
      while (ck) {
        const [px, pz] = ck.split(',').map(Number);
        full.push({ x: px, z: pz });
        ck = cameFrom.get(ck);
      }
      full.reverse();
      return full.length > 1 ? full.slice(1) : [{ x: gx, z: gz }];
    }

    open.delete(curK);
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (grid.isBlocked(nx, nz)) continue;
      const nk = k(nx, nz);
      const tentativeG = cur.g + 1;
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, curK);
        gScore.set(nk, tentativeG);
        open.set(nk, { x: nx, z: nz, g: tentativeG, f: tentativeG + h(nx, nz) });
      }
    }
  }
  // No path within the cap → head straight; movement/collision handles contact.
  return [{ x: gx, z: gz }];
};
