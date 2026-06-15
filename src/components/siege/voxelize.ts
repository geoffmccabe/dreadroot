// Mesh → primitive boxes via voxelize + GREEDY MERGE. Instead of one box per 1m cell, adjacent
// filled cells are merged into the fewest large axis-aligned boxes (the solid interior collapses
// to one big box; only the surface detail stays small). Output is plain Box3s — exactly what the
// engine's collision grid uses — at a fraction of the count of raw voxels.
//   1. surface-sample triangles → per-(x,z) column min/max height,
//   2. solid-fill each column (clean solid, no sampling noise),
//   3. greedy-merge filled cells into maximal boxes (grow +x, then +y, then +z).
// `cell` controls resolution (bigger = fewer/coarser boxes, smaller = more/finer) for < / >.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const SOLID_CAP = 80000; // bail on huge meshes at fine resolution — caller keeps the box

export function voxelizeGeometry(
  geo: THREE.BufferGeometry,
  world: THREE.Matrix4,
  cell = 1.0,
  cap = 2000,
): THREE.Box3[] {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const idx = geo.index;
  const triCount = idx ? (idx.count / 3) | 0 : (pos.count / 3) | 0;

  // 1. surface-sample → per-column [minCy, maxCy]
  const cols = new Map<string, [number, number]>();
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    _a.fromBufferAttribute(pos, i0).applyMatrix4(world);
    _b.fromBufferAttribute(pos, i1).applyMatrix4(world);
    _c.fromBufferAttribute(pos, i2).applyMatrix4(world);
    const e = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _a.distanceTo(_c));
    const N = Math.min(14, Math.max(1, Math.ceil(e / (cell * 0.5))));
    for (let si = 0; si <= N; si++) {
      for (let ti = 0; ti <= N - si; ti++) {
        const u = si / N, v = ti / N;
        const x = _a.x + (_b.x - _a.x) * u + (_c.x - _a.x) * v;
        const y = _a.y + (_b.y - _a.y) * u + (_c.y - _a.y) * v;
        const z = _a.z + (_b.z - _a.z) * u + (_c.z - _a.z) * v;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        const k = `${cx},${cz}`;
        const span = cols.get(k);
        if (!span) cols.set(k, [cy, cy]);
        else { if (cy < span[0]) span[0] = cy; if (cy > span[1]) span[1] = cy; }
      }
    }
  }

  // 2. solid-fill each column
  const solid = new Set<string>();
  for (const [k, [mn, mx]] of cols) {
    const ci = k.indexOf(',');
    const cx = Number(k.slice(0, ci)), cz = Number(k.slice(ci + 1));
    for (let cy = mn; cy <= mx; cy++) {
      solid.add(`${cx},${cy},${cz}`);
      if (solid.size > SOLID_CAP) return []; // too big at this resolution → caller keeps the box
    }
  }

  // 3. greedy-merge filled cells into maximal boxes
  const claimed = new Set<string>();
  const free = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    return solid.has(k) && !claimed.has(k);
  };
  const cells = [...solid].map((s) => s.split(',').map(Number) as [number, number, number]);
  cells.sort((p, q) => p[1] - q[1] || p[0] - q[0] || p[2] - q[2]); // lowest first
  const out: THREE.Box3[] = [];
  for (const [x0, y0, z0] of cells) {
    if (claimed.has(`${x0},${y0},${z0}`)) continue;
    let x1 = x0; while (free(x1 + 1, y0, z0)) x1++;            // grow +x
    let y1 = y0;                                              // grow +y over the x-run
    growY: while (true) {
      for (let x = x0; x <= x1; x++) if (!free(x, y1 + 1, z0)) break growY;
      y1++;
    }
    let z1 = z0;                                              // grow +z over the x×y slab
    growZ: while (true) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (!free(x, y, z1 + 1)) break growZ;
      z1++;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) claimed.add(`${x},${y},${z}`);
    out.push(new THREE.Box3(
      new THREE.Vector3(x0 * cell, y0 * cell, z0 * cell),
      new THREE.Vector3((x1 + 1) * cell, (y1 + 1) * cell, (z1 + 1) * cell),
    ));
    if (out.length >= cap) break;
  }
  return out;
}
