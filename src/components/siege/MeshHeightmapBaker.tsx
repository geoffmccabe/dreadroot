// MeshHeightmapBaker — for BAKED-MESH maps (Adventure Town / Snowy Cabin) whose "ground" is the glTF
// collider mesh, not a real heightfield. Once the collider BVHs are built, this ray-traces the mesh
// from HIGH ABOVE on a grid (the same sky-down trace the user asked for), stores the true top-surface
// elevation, and registers it as the priority height provider (see terrainHeight.setBakedHeightProvider).
//
// Effect: sampleHeight() now returns the REAL elevation everywhere, so the player's gravity floor and
// every entity's groundAt() sit on the actual surface — players and monsters can't sink into the lower
// terrain layer / false Y=0 plane. The bake is spread over frames so it never hitches.
//
// Caveat: a single-value heightmap is the TOP surface, so under a roofed building it reports the roof.
// These maps are mostly open terrain; the rare enclosed cell is acceptable for a ground floor.

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { meshCollidersEnabled, meshGroundHeight, forEachMeshInstanceBox } from './meshColliderSystem';
import { setBakedHeightProvider } from './terrainHeight';

const SENTINEL = -99999;   // a grid cell with no mesh below it
const SKY = 1000;          // ray origin Y — above any peak
const PER_FRAME = 1500;    // samples baked per frame

// Fill SENTINEL holes by repeatedly averaging each hole's known neighbours, so every in-bounds cell
// ends up with a real elevation (no bogus Y=0 floor leaking through). Bounded passes; converges fast.
function fillHoles(G: Float32Array, R: number) {
  for (let pass = 0; pass < R; pass++) {
    let holes = 0, changed = 0;
    const next = G.slice();
    for (let i = 0; i < G.length; i++) {
      if (G[i] >= SENTINEL + 1) continue;           // already valid
      holes++;
      const c = i % R, r = (i / R) | 0;
      let sum = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= R || cc >= R) continue;
        const v = G[rr * R + cc];
        if (v >= SENTINEL + 1) { sum += v; n++; }
      }
      if (n) { next[i] = sum / n; changed++; }
    }
    G.set(next);
    if (!holes || !changed) break;
  }
}

export function MeshHeightmapBaker({ active }: { active: boolean }) {
  const st = useRef({
    phase: 'idle' as 'idle' | 'wait' | 'bake' | 'done',
    grid: null as Float32Array | null,
    res: 0, minX: 0, minZ: 0, spanX: 1, spanZ: 1, i: 0,
  });

  useEffect(() => {
    st.current.phase = active ? 'wait' : 'idle';
    if (!active) setBakedHeightProvider(null);
    return () => { setBakedHeightProvider(null); st.current.phase = 'idle'; st.current.grid = null; };
  }, [active]);

  useFrame(() => {
    const s = st.current;
    if (s.phase === 'wait') {
      if (!meshCollidersEnabled()) return;                 // colliders still building
      const box = new THREE.Box3(); box.makeEmpty();
      let any = false;
      forEachMeshInstanceBox((aabb) => { box.union(aabb); any = true; });
      if (!any || !isFinite(box.min.x)) return;            // nothing to bake yet
      const pad = 6;
      s.minX = box.min.x - pad; s.minZ = box.min.z - pad;
      s.spanX = Math.max(1, (box.max.x + pad) - s.minX);
      s.spanZ = Math.max(1, (box.max.z + pad) - s.minZ);
      s.res = Math.min(384, Math.max(64, Math.ceil(Math.max(s.spanX, s.spanZ) / 1.5)));   // ~1.5 m cells
      s.grid = new Float32Array(s.res * s.res).fill(SENTINEL);
      s.i = 0; s.phase = 'bake';
      return;
    }
    if (s.phase === 'bake' && s.grid) {
      const total = s.res * s.res;
      const end = Math.min(s.i + PER_FRAME, total);
      for (; s.i < end; s.i++) {
        const col = s.i % s.res, row = (s.i / s.res) | 0;
        const x = s.minX + (col / (s.res - 1)) * s.spanX;
        const z = s.minZ + (row / (s.res - 1)) * s.spanZ;
        const g = meshGroundHeight(x, z, SKY);
        s.grid[s.i] = g == null ? SENTINEL : g;
      }
      if (s.i >= total) {
        // HOLE-FILL: a sky-down ray can miss a cell (a gap between triangles, a thin spot). An unfilled
        // hole would fall through to the flat Y=0 false floor → a monster/player buried there. Dilate the
        // known elevations into the holes (iterative nearest-neighbour average) so EVERY in-bounds cell
        // carries a real surface height. One-time cost; runs once when the bake finishes.
        fillHoles(s.grid, s.res);
        const G = s.grid, R = s.res, mnX = s.minX, mnZ = s.minZ, sX = s.spanX, sZ = s.spanZ;
        // Bilinear sampler; returns null only when OUTSIDE the baked grid (the existing flat provider
        // serves those). Inside the grid the hole-fill guarantees no sentinels remain.
        setBakedHeightProvider((qx, qz) => {
          const fx = ((qx - mnX) / sX) * (R - 1), fz = ((qz - mnZ) / sZ) * (R - 1);
          if (fx < 0 || fz < 0 || fx > R - 1 || fz > R - 1) return null;
          const x0 = Math.floor(fx), z0 = Math.floor(fz);
          const x1 = Math.min(x0 + 1, R - 1), z1 = Math.min(z0 + 1, R - 1);
          const tx = fx - x0, tz = fz - z0;
          const h00 = G[z0 * R + x0], h10 = G[z0 * R + x1], h01 = G[z1 * R + x0], h11 = G[z1 * R + x1];
          if (h00 < SENTINEL + 1 || h10 < SENTINEL + 1 || h01 < SENTINEL + 1 || h11 < SENTINEL + 1) return null;
          return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
        });
        s.phase = 'done';
      }
    }
  });

  return null;
}
