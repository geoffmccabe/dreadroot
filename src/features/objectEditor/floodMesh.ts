// Turns a flood-fill footprint (floodFill.ts) into one flat water-surface geometry. Each RLE run
// (a horizontal strip of filled cells) becomes a single quad, so a whole pool is only a handful of
// triangles — cheap to render as one static mesh. Every quad is grown 5 cm on all sides so the
// strips overlap slightly and the outer edge tucks ~5 cm past the shoreline / into walls, hiding the
// seam. Vertices are in WORLD space (the pool is anchored where it was flooded), so the mesh renders
// at the origin with an identity transform.
import * as THREE from 'three';
import type { FloodData } from './floodFill';

const DILATE = 0.05;   // metres to grow each strip past the shoreline (kills edge gaps)

export function buildFloodGeometry(d: FloodData): THREE.BufferGeometry {
  const nRuns = d.runs.length / 3;
  const pos = new Float32Array(nRuns * 4 * 3);
  const uv = new Float32Array(nRuns * 4 * 2);
  const idx = new Uint32Array(nRuns * 6);
  let vp = 0, vu = 0, ii = 0, base = 0;
  const y = d.level;
  for (let i = 0; i < d.runs.length; i += 3) {
    const row = d.runs[i], startCol = d.runs[i + 1], len = d.runs[i + 2];
    const x0 = d.minX + startCol * d.cell - DILATE;
    const x1 = d.minX + (startCol + len) * d.cell + DILATE;
    const z0 = d.minZ + row * d.cell - DILATE;
    const z1 = d.minZ + (row + 1) * d.cell + DILATE;
    pos[vp++] = x0; pos[vp++] = y; pos[vp++] = z0;
    pos[vp++] = x1; pos[vp++] = y; pos[vp++] = z0;
    pos[vp++] = x1; pos[vp++] = y; pos[vp++] = z1;
    pos[vp++] = x0; pos[vp++] = y; pos[vp++] = z1;
    uv[vu++] = x0; uv[vu++] = z0; uv[vu++] = x1; uv[vu++] = z0;
    uv[vu++] = x1; uv[vu++] = z1; uv[vu++] = x0; uv[vu++] = z1;
    idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 1;
    idx[ii++] = base; idx[ii++] = base + 3; idx[ii++] = base + 2;
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();   // all faces point up (material is DoubleSide regardless)
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
