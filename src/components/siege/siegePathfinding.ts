// siegePathfinding — on-demand grid A* for monsters that get STUCK on a wall/building (e.g. a player
// hiding in a garage). No prebuilt navmesh: occupancy is tested per move as an EDGE check — cast a
// chest-height ray from one cell to the next; if it hits a wall, that move is blocked; a doorway is
// just open air, so the route threads through it. Works for BOTH the SciFi City (BVH mesh walls) and
// box-collider worlds (rocks/towns). Called only when a monster can't make progress, recomputed every
// ~0.8s, so the per-build cost stays off the normal hot path.
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import { raycastMesh } from './meshColliderSystem';

const CELL = 1.5;          // grid resolution (m) — ~a doorway wide
const MAX_NODES = 700;     // A* expansion cap (bounds cost; null past it → caller falls back to straight)
const MAX_RANGE = 64;      // don't even try if the player is farther than this (m, Manhattan)
const CHEST = 1.1;         // ray height above the floor for the wall test

export interface PathPt { x: number; z: number }

const cellOf = (v: number) => Math.floor(v / CELL);
const worldOf = (c: number) => (c + 0.5) * CELL;
const ckey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

// Is moving from (ax,az) to (bx,bz) blocked by a wall at floor level refY? Chest-height ray for BVH
// (city), plus a box-overlap test at the destination for box-collider worlds.
function edgeBlocked(ax: number, az: number, bx: number, bz: number, refY: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz) || 1;
  const hit = raycastMesh(ax, refY + CHEST, az, dx / d, 0, dz / d, d + 0.05);
  if (hit != null && hit <= d + 0.05) return true;
  const cy = refY + 0.6;
  for (const grid of [worldCollisionGrid, monsterColliderGrid]) {
    const cnt = grid.getNearby(bx, bz, 0.1);
    const res = grid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      if (bx >= b.min.x && bx <= b.max.x && bz >= b.min.z && bz <= b.max.z &&
          b.min.y <= cy && b.max.y >= cy && b.max.y - b.min.y > 0.5) return true;
    }
  }
  return false;
}

// Minimal binary min-heap keyed by f-score.
class Heap {
  private a: { k: number; f: number }[] = [];
  get size() { return this.a.length; }
  push(k: number, f: number) {
    const a = this.a; a.push({ k, f }); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): number {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r;
      if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top.k;
  }
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A route of world waypoints from (sx,sz) to near (gx,gz), or null if none found / not worth it.
 *  refY = the floor level both ends share (the monster's feet). */
export function findPath(sx: number, sz: number, gx: number, gz: number, refY: number): PathPt[] | null {
  if (Math.abs(gx - sx) + Math.abs(gz - sz) > MAX_RANGE) return null;
  const scx = cellOf(sx), scz = cellOf(sz), gcx = cellOf(gx), gcz = cellOf(gz);
  if (scx === gcx && scz === gcz) return null;
  const startK = ckey(scx, scz), goalK = ckey(gcx, gcz);
  const gScore = new Map<number, number>([[startK, 0]]);
  const cameFrom = new Map<number, number>();
  const cellXZ = new Map<number, [number, number]>([[startK, [scx, scz]]]);
  const closed = new Set<number>();
  const open = new Heap();
  const h = (cx: number, cz: number) => Math.hypot(cx - gcx, cz - gcz);
  open.push(startK, h(scx, scz));
  let nodes = 0;
  while (open.size && nodes < MAX_NODES) {
    const curK = open.pop();
    if (curK === goalK) return reconstruct(cameFrom, cellXZ, curK, gx, gz);
    if (closed.has(curK)) continue;
    closed.add(curK); nodes++;
    const [cx, cz] = cellXZ.get(curK)!;
    const ax = worldOf(cx), az = worldOf(cz);
    const baseG = gScore.get(curK)!;
    for (const [ox, oz] of NB) {
      const ncx = cx + ox, ncz = cz + oz, nk = ckey(ncx, ncz);
      if (closed.has(nk)) continue;
      const bx = worldOf(ncx), bz = worldOf(ncz);
      if (edgeBlocked(ax, az, bx, bz, refY)) continue;
      const stepG = baseG + (ox && oz ? 1.4142 : 1);
      if (stepG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, stepG); cameFrom.set(nk, curK); cellXZ.set(nk, [ncx, ncz]);
        open.push(nk, stepG + h(ncx, ncz));
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, cellXZ: Map<number, [number, number]>, goalK: number, gx: number, gz: number): PathPt[] {
  const cells: number[] = [goalK];
  let k = goalK;
  while (cameFrom.has(k)) { k = cameFrom.get(k)!; cells.push(k); }
  cells.reverse();
  // Cell centres → waypoints, dropping the start cell; collapse collinear runs; end at the real goal.
  const pts: PathPt[] = [];
  for (let i = 1; i < cells.length; i++) { const [cx, cz] = cellXZ.get(cells[i])!; pts.push({ x: worldOf(cx), z: worldOf(cz) }); }
  pts.push({ x: gx, z: gz });
  const out: PathPt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (Math.abs(cross) < 0.01) continue;   // collinear → skip the midpoint
    }
    out.push(pts[i]);
  }
  return out;
}
