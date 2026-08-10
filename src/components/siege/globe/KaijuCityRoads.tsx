// KaijuCityRoads — the asphalt between the buildings.
//
// Geoff: "Also there are no roads. Can you put in the roads between the buildings somehow?"
//
// Worth more than it sounds. A city is not its buildings, it is the buildings AND the gaps, and the
// gaps are what the eye measures scale against — 59,202 boxes standing on bare sand read as a field
// of boxes, while the same boxes with a street grid running between them read as a city. The roads
// are also the only thing in the scene at human scale, which is precisely what makes a 300 m
// creature look 300 m tall.
//
// ONE MESH, BUILT ONCE. 15,571 roads reduce to about 30,000 segments, which is 30,000 quads — 60,000
// triangles in a single non-indexed buffer, built on load and never touched again. That is less
// geometry than one of the Kaiju.
//
// The joins are simply overlapping quads. A proper mitre would need the angle at every vertex and
// would still fail on the sharp ones; overlapping is invisible on an opaque flat surface, and at a
// junction the overlap IS the junction.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { loadRoads, getRoads, ROAD_WIDTH_M, type Road } from './cityRoads';

/**
 * How far above the ground the asphalt sits, in metres.
 *
 * Small, and backed up by polygonOffset rather than replaced by it. The terrain inside the city is
 * flat at the city's declared ground, so a road at the same height would z-fight along its whole
 * length; but near the coast the ground ramps down into the beach, and a large lift would leave the
 * seafront roads visibly hovering. Twenty centimetres is under a kerb and above the fighting.
 */
const ROAD_LIFT_M = 0.2;

export function KaijuCityRoads({ slug }: { slug: string }) {
  const [roads, setRoads] = useState<Road[] | null>(getRoads());
  useEffect(() => { void loadRoads(slug).then(setRoads); }, [slug]);

  const geometry = useMemo(() => {
    if (!roads || !roads.length) return null;
    const U = 1 / METRES_PER_UNIT;

    let segments = 0;
    for (const r of roads) segments += r.pts.length / 2 - 1;
    const pos = new Float32Array(segments * 6 * 3);
    const col = new Float32Array(segments * 6 * 3);
    let p = 0, c = 0;

    const y = ROAD_LIFT_M * U;
    for (const r of roads) {
      const half = (ROAD_WIDTH_M[r.cls] ?? 9) * 0.5 * U;
      // Big roads are paler: they are wider, newer, and more lit, and it separates the arterials
      // from the side streets when you are high enough to see the pattern rather than the surface.
      const g = r.cls <= 2 ? 0.30 : r.cls <= 4 ? 0.25 : 0.20;
      const n = r.pts.length / 2;
      for (let i = 1; i < n; i++) {
        const ax = r.pts[(i - 1) * 2] * U, az = r.pts[(i - 1) * 2 + 1] * U;
        const bx = r.pts[i * 2] * U, bz = r.pts[i * 2 + 1] * U;
        let dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) continue;
        dx /= len; dz /= len;
        // Perpendicular in the ground plane. The frame is (east, up, south), so this is a plain
        // 2D normal in x/z and no cross product is needed.
        const nx = -dz * half, nz = dx * half;

        const q = [
          ax - nx, az - nz, ax + nx, az + nz, bx + nx, bz + nz,
          ax - nx, az - nz, bx + nx, bz + nz, bx - nx, bz - nz,
        ];
        for (let k = 0; k < 6; k++) {
          pos[p++] = q[k * 2]; pos[p++] = y; pos[p++] = q[k * 2 + 1];
          col[c++] = g * 0.98; col[c++] = g; col[c++] = g * 1.06;   // asphalt is faintly blue
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, p), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, c), 3));
    // Flat and upward everywhere, so there is no reason to make the GPU work it out per vertex.
    const nrm = new Float32Array(p);
    for (let i = 1; i < p; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    console.log(`[city] ${(p / 9).toLocaleString()} road triangles`);
    return geo;
  }, [roads]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => new THREE.MeshLambertMaterial({
    vertexColors: true,
    // POLYGON OFFSET, not a bigger lift. It biases depth only, so the road can sit two centimetres
    // above the ground in depth terms while staying exactly where it is in space — which is what
    // keeps it from z-fighting without making it hover when the ground slopes away underneath.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  const mesh = useRef<THREE.Mesh>(null);
  if (!geometry) return null;
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} receiveShadow />;
}
