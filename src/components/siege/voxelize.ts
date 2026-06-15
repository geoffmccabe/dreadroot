// Shared mesh voxelizer. Samples whole TRIANGLES (not just vertices) into 1m cells, so a
// low-poly rock becomes a connected shell of 1m boxes that follows its surface — instead of
// a few scattered corner cubes (vertex-only) or one oversized AABB. Used at load time
// (WorldObjectsLayer) and by the interactive V tool (VoxelizeTool), so both behave identically.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();

export function voxelizeGeometry(
  geo: THREE.BufferGeometry,
  world: THREE.Matrix4,
  cell = 1.0,
  cap = 4000,
): THREE.Box3[] {
  const out: THREE.Box3[] = [];
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return out;
  const idx = geo.index;
  const triCount = idx ? (idx.count / 3) | 0 : (pos.count / 3) | 0;
  const seen = new Set<string>();
  const add = (x: number, y: number, z: number) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const key = `${cx},${cy},${cz}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(new THREE.Box3(
      new THREE.Vector3(cx * cell, cy * cell, cz * cell),
      new THREE.Vector3((cx + 1) * cell, (cy + 1) * cell, (cz + 1) * cell),
    ));
  };
  for (let t = 0; t < triCount && out.length < cap; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    _a.fromBufferAttribute(pos, i0).applyMatrix4(world);
    _b.fromBufferAttribute(pos, i1).applyMatrix4(world);
    _c.fromBufferAttribute(pos, i2).applyMatrix4(world);
    const e = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _a.distanceTo(_c));
    const N = Math.min(10, Math.max(1, Math.ceil(e / (cell * 0.6))));
    for (let si = 0; si <= N && out.length < cap; si++) {
      for (let ti = 0; ti <= N - si; ti++) {
        const u = si / N, v = ti / N;
        _p.set(
          _a.x + (_b.x - _a.x) * u + (_c.x - _a.x) * v,
          _a.y + (_b.y - _a.y) * u + (_c.y - _a.y) * v,
          _a.z + (_b.z - _a.z) * u + (_c.z - _a.z) * v,
        );
        add(_p.x, _p.y, _p.z);
      }
    }
  }
  return out;
}
