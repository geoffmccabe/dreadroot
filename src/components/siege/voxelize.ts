// Shell voxelizer. Turns a mesh into a HOLLOW 1m shell (not a solid block of cubes):
//   1. surface-sample triangles → per-(x,z) column min/max height,
//   2. solid-fill each column between min and max (gives a clean solid, no sampling noise),
//   3. keep only OUTER shell cells — drop any cell that is buried (top + all 4 sides filled).
// That also drops the flat underside (a bottom-interior cell has rock above + filled sides),
// leaving the top cap + side walls with an OPEN bottom — fine because objects always rest on
// something below that covers the gap. Far fewer cells than a solid/dense fill.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
const SOLID_CAP = 60000; // bail on huge meshes (mountains) — leave those as a box

export function voxelizeGeometry(
  geo: THREE.BufferGeometry,
  world: THREE.Matrix4,
  cell = 1.0,
  cap = 4000,
): THREE.Box3[] {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const idx = geo.index;
  const triCount = idx ? (idx.count / 3) | 0 : (pos.count / 3) | 0;

  // 1. surface-sample → per-column [minCy, maxCy]
  const cols = new Map<string, [number, number]>(); // "cx,cz" → [mn, mx]
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
    const [cx, cz] = k.split(',').map(Number);
    for (let cy = mn; cy <= mx; cy++) {
      solid.add(`${cx},${cy},${cz}`);
      if (solid.size > SOLID_CAP) return []; // too big to voxelize sanely → caller keeps the box
    }
  }

  // 3. shell extract — drop cells buried on top + all 4 sides (interior + flat underside)
  const has = (cx: number, cy: number, cz: number) => solid.has(`${cx},${cy},${cz}`);
  const out: THREE.Box3[] = [];
  for (const s of solid) {
    const [cx, cy, cz] = s.split(',').map(Number);
    if (has(cx, cy + 1, cz) && has(cx + 1, cy, cz) && has(cx - 1, cy, cz) && has(cx, cy, cz + 1) && has(cx, cy, cz - 1)) continue;
    out.push(new THREE.Box3(
      new THREE.Vector3(cx * cell, cy * cell, cz * cell),
      new THREE.Vector3((cx + 1) * cell, (cy + 1) * cell, (cz + 1) * cell),
    ));
    if (out.length >= cap) break;
  }
  return out;
}
