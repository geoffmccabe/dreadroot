// GlobeTerrain — the Mini Earth planet surface: a cube-sphere quadtree of displaced patches,
// streamed by camera distance. See docs/MINI_EARTH_P1_BUILD.md steps B3/B4.
//
// DATA TILES vs RENDER PATCHES (the one non-obvious decision here)
// ---------------------------------------------------------------
// A data tile is 257x257 samples. Rendering a patch at that resolution would be 131,072
// triangles for ONE patch, so a few dozen visible patches would be millions of triangles.
// Instead the two are decoupled:
//   • data tile  = the network/caching unit, 257x257, one HTTP request
//   • render patch = the geometry unit, 65x65 vertices (8,192 triangles)
// A patch at quadtree depth D reads a sub-rectangle of the data tile at level D-2, because
// 65 vertices over a quarter of a 257-sample tile lands exactly on the tile's own samples
// (4 x 64 + 1 = 257). So the render tree goes two levels deeper than the data pyramid and
// still shows every sample we have, with 16x fewer triangles per patch.
//
// LOD is DISTANCE-based, with hysteresis. Both are deliberate: this repo has a documented
// case where naive per-cell frustum culling made the frame rate 20x WORSE, and split/merge
// without hysteresis thrashes at the threshold.
//
// A node only splits once all four children's data is resident, so there are never holes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { enqueueJob } from '@/lib/budgetedWork';
import { toRenderX, toRenderY, toRenderZ } from '@/lib/renderSpace';
import {
  TILE, PLANET_RADIUS, METRES_PER_UNIT, faceUvToDirection, tileArcUnits, tileUvRange,
  sampleSpacingUnits,
} from './cubeSphere';
import {
  loadManifest, getManifest, getTile, hasTile, requestTile, sampleTileBilinear, clearEarthTiles,
} from './earthTiles';
import { detailMetres } from './globeDetail';

/** Vertices per patch side. 65 = 64 quads = 8,192 triangles. */
const PATCH = 65;
/** Data level is this many quadtree levels shallower than the render depth (see header). */
const DATA_LAG = 2;

/**
 * Split when the patch's arc subtends more than this fraction of its distance.
 *
 * This was 2.2, which is why the first look was blocky: from orbit the whole planet stayed at
 * depth 0, i.e. SIX patches of 65 vertices for the entire Earth, and each patch sampled its tile
 * at stride 4 so three quarters of the data we had was thrown away. Because a render patch is 65
 * vertices against a 257-sample tile, depth must reach DATA_LAG (2) before a tile is shown at its
 * true resolution. At orbit the depth-1 ratio is about 0.52, so the threshold has to sit below
 * that for the planet to look like anything.
 */
const SPLIT_RATIO = 0.45;
/** Merge only well below the split point, or nodes thrash at the boundary. */
const MERGE_RATIO = 0.30;

/** Re-evaluate the tree at most this often (ms). The camera cannot outrun it at these scales. */
const REEVAL_MS = 120;

/** Runaway-subdivision backstop. The distance test should keep leaves in the low hundreds. */
const MAX_LEAVES = 600;

/**
 * How deep the RENDER tree may go, independent of how deep the DATA goes.
 *
 * The global data stops at level 4 (2.44 km per sample), but two things go deeper: procedural
 * detail, which produces relief at any scale, and the 225 landmark regions carrying real
 * Copernicus GLO-30 down to level 10 (38 m). Depth 12 is level 10 plus DATA_LAG, i.e. the depth
 * at which a level-10 tile renders at its true resolution.
 *
 * Outside a landmark region the deeper tiles simply 404, `childrenReady` stays false, and the
 * node stops subdividing on its own. That is why no region list is needed on the client: the
 * tree finds its own floor wherever it is, and earthTiles backs off failed requests so a miss
 * is not retried every frame.
 */
const MAX_RENDER_DEPTH = 12;

/** Skirt depth as a fraction of patch arc: hides cracks where LOD levels meet. */
const SKIRT_FRAC = 0.03;

interface NodeId { face: number; depth: number; x: number; y: number }
const idKey = (n: NodeId) => `${n.face}:${n.depth}:${n.x}:${n.y}`;

/**
 * Data level, tile index and sub-rectangle for a render node.
 *
 * `span` and `stride` are FLOATS. Once the render tree goes deeper than the data pyramid plus
 * DATA_LAG (which it now does, so procedural detail has somewhere to live), a patch covers less
 * than one texel per vertex and must sample the tile bilinearly at fractional coordinates.
 * Integer indexing there silently reads undefined and produces NaN geometry.
 */
function dataFor(n: NodeId, maxLevel: number) {
  const level = Math.max(0, Math.min(n.depth - DATA_LAG, maxLevel));
  const shift = n.depth - level;              // how many quadtree steps the tile is above us
  const tx = n.x >> shift, ty = n.y >> shift;
  const span = (TILE - 1) / Math.pow(2, shift);   // samples of the tile this patch covers
  const stride = span / (PATCH - 1);
  const ox = (n.x - (tx * Math.pow(2, shift))) * span;
  const oy = (n.y - (ty * Math.pow(2, shift))) * span;
  return { level, tx, ty, ox, oy, stride };
}

/** Centre direction of a node, written into `out`. */
function nodeCentre(n: NodeId, out: Float64Array): void {
  const [u0, u1] = tileUvRange(n.x, n.depth);
  const [v0, v1] = tileUvRange(n.y, n.depth);
  faceUvToDirection(n.face, (u0 + u1) / 2, (v0 + v1) / 2, out);
}

/**
 * Build one patch's geometry. Elevation comes from the data tile; colour is a simple
 * height/latitude ramp so the planet reads as Earth before the biome work of P3.
 */
function buildPatchGeometry(n: NodeId, maxLevel: number): { geo: THREE.BufferGeometry; water: THREE.BufferGeometry | null } | null {
  const d = dataFor(n, maxLevel);
  const tile = getTile(n.face, d.level, d.tx, d.ty);
  if (!tile) return null;

  const [u0, u1] = tileUvRange(n.x, n.depth);
  const [v0, v1] = tileUvRange(n.y, n.depth);
  const du = (u1 - u0) / (PATCH - 1);
  const dv = (v1 - v0) / (PATCH - 1);

  // Skirt: one extra ring around the patch, dropped below the surface.
  const side = PATCH + 2;
  const count = side * side;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  // Water layer: same lattice at sea level, alpha fading out across the coastline. Built here so
  // it shares the patch's directions and lifetime rather than needing a second quadtree.
  const wpos = new Float32Array(count * 3);
  const wcol = new Float32Array(count * 4);   // RGBA: alpha carries the coastline fade
  let anyOcean = false;
  const dir = new Float64Array(3);
  const skirtDrop = tileArcUnits(n.depth) * SKIRT_FRAC;
  // Vertex spacing of THIS patch, which band-limits the procedural octaves.
  const patchSpacing = tileArcUnits(n.depth) / (PATCH - 1);

  for (let j = 0; j < side; j++) {
    // Clamp into the patch for the skirt ring, so skirt verts sit under the true edge.
    const jj = j === 0 ? 0 : j === side - 1 ? PATCH - 1 : j - 1;
    const isSkirtRow = j === 0 || j === side - 1;
    for (let i = 0; i < side; i++) {
      const ii = i === 0 ? 0 : i === side - 1 ? PATCH - 1 : i - 1;
      const isSkirt = isSkirtRow || i === 0 || i === side - 1;

      faceUvToDirection(n.face, u0 + ii * du, v0 + jj * dv, dir);
      const baseM = sampleTileBilinear(tile, d.ox + ii * d.stride, d.oy + jj * d.stride);
      // Procedural amplification: the measured data is one sample per 2.44 km, which is a flat
      // plane at creature scale. This adds the detail no global dataset can supply, band-limited
      // to what this patch can represent. Same function the ground sampler uses, so the Kaiju
      // stands on exactly the surface you can see.
      const metres = baseM + detailMetres(dir[0], dir[1], dir[2], PLANET_RADIUS, baseM, patchSpacing);
      // TRUE elevation, including below sea level: the seafloor is real geometry you can swim
      // over. It used to be clamped up to sea level to stop an OPAQUE ocean shell z-fighting it,
      // but that shell is gone. The water surface is now built as a separate translucent layer in
      // this same patch (see below) which never writes depth, so it cannot fight anything.
      const r = PLANET_RADIUS + metres / METRES_PER_UNIT - (isSkirt ? skirtDrop : 0);

      const k = (j * side + i) * 3;
      pos[k] = toRenderX(dir[0] * r);
      pos[k + 1] = toRenderY(dir[1] * r);
      pos[k + 2] = toRenderZ(dir[2] * r);

      // Land ramp: green lowland -> brown upland -> grey rock -> white peaks/ice.
      // Below sea level stays dark, mostly hidden by the ocean shell.
      const lat = Math.abs(dir[1]);                 // |sin(latitude)|, 1 at the poles
      const snowLine = 2600 - 2400 * lat * lat;     // metres; drops toward the poles
      let r0: number, g0: number, b0: number;
      if (metres < 0) {
        // Shallow shelf -> bright blue, abyss -> near-black blue. -6000 m covers most of the ocean.
        const t = Math.min(1, -metres / 6000);
        r0 = 0.10 - 0.07 * t; g0 = 0.32 - 0.24 * t; b0 = 0.55 - 0.32 * t;
      }
      else if (metres > snowLine) { r0 = 0.92; g0 = 0.93; b0 = 0.96; }
      else {
        const t = Math.min(1, metres / Math.max(1, snowLine));
        r0 = 0.24 + 0.34 * t; g0 = 0.42 - 0.10 * t; b0 = 0.20 + 0.10 * t;
        if (lat > 0.86) { const p = (lat - 0.86) / 0.14; r0 += (0.92 - r0) * p; g0 += (0.93 - g0) * p; b0 += (0.96 - b0) * p; }
      }
      col[k] = r0; col[k + 1] = g0; col[k + 2] = b0;

      // Water vertex: always at sea level. Alpha ramps from clear at the shoreline to nearly
      // opaque by ~120 m depth, which gives soft beaches instead of a hard blue edge, and hides
      // the seafloor from orbit the way a real ocean does.
      const wr = PLANET_RADIUS - (isSkirt ? skirtDrop : 0);
      wpos[k] = toRenderX(dir[0] * wr);
      wpos[k + 1] = toRenderY(dir[1] * wr);
      wpos[k + 2] = toRenderZ(dir[2] * wr);
      const depth = -metres;
      if (depth > 0) anyOcean = true;
      const wa = depth <= 0 ? 0 : Math.min(0.94, depth / 120 * 0.94);
      const deep = Math.min(1, depth / 4000);
      const wk = (j * side + i) * 4;
      wcol[wk] = 0.10 - 0.06 * deep;
      wcol[wk + 1] = 0.34 - 0.24 * deep;
      wcol[wk + 2] = 0.62 - 0.30 * deep;
      wcol[wk + 3] = wa;
    }
  }

  const idx = new Uint32Array((side - 1) * (side - 1) * 6);
  let w = 0;
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const a = j * side + i, b = a + 1, c = a + side, e = c + 1;
      idx[w++] = a; idx[w++] = c; idx[w++] = b;
      idx[w++] = b; idx[w++] = c; idx[w++] = e;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  let water: THREE.BufferGeometry | null = null;
  if (anyOcean) {
    water = new THREE.BufferGeometry();
    water.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    water.setAttribute('color', new THREE.BufferAttribute(wcol, 4));
    water.setIndex(new THREE.BufferAttribute(idx, 1));
    water.computeVertexNormals();
    water.computeBoundingSphere();
  }
  return { geo, water };
}

/** True once every data tile the four children need is resident. */
function childrenReady(n: NodeId, maxLevel: number): boolean {
  for (let c = 0; c < 4; c++) {
    const child: NodeId = { face: n.face, depth: n.depth + 1, x: n.x * 2 + (c & 1), y: n.y * 2 + (c >> 1) };
    const d = dataFor(child, maxLevel);
    if (!hasTile(child.face, d.level, d.tx, d.ty)) {
      void requestTile(child.face, d.level, d.tx, d.ty);
      return false;
    }
  }
  return true;
}

export function GlobeTerrain({ onReady }: { onReady?: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const [manifestReady, setManifestReady] = useState(false);

  const meshes = useRef(new Map<string, THREE.Mesh>());
  const waters = useRef(new Map<string, THREE.Mesh>());
  const leafKeys = useRef(new Set<string>());
  // Nodes that were SPLIT last evaluation. Hysteresis needs to know the previous state:
  // a split node stays split until it falls below MERGE_RATIO, while a leaf only splits
  // once it passes the higher SPLIT_RATIO. Without this the two thresholds do nothing.
  const splitNodes = useRef(new Set<string>());
  const building = useRef(new Set<string>());
  const lastEval = useRef(0);
  const readyFired = useRef(false);

  const material = useMemo(
    // fog:false — the sky system's exponential fog is opaque at planetary distances. GlobeCamera
    // nulls scene.fog each frame; this makes a stray frame harmless too.
    () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, fog: false }),
    [],
  );

  // Water. transparent + depthWrite:false is the whole trick: it blends over the seafloor and can
  // never fight it for depth, which is what made the first opaque ocean shell flicker across the
  // entire planet. DoubleSide so it is still there when you are underneath looking up.
  const waterMat = useMemo(
    () => new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    }),
    [],
  );

  useEffect(() => {
    let alive = true;
    loadManifest()
      .then((m) => {
        if (!alive) return;
        console.log(`[earth] manifest ok: maxLevel=${m.maxLevel} tile=${m.tileSize} radius=${m.planetRadiusUnits}u`);
        setManifestReady(true);
      })
      .catch((e) => console.error('[earth] manifest failed', e));
    return () => {
      alive = false;
      clearEarthTiles();
    };
  }, []);

  // Drop every mesh on unmount so leaving the map does not leak GPU memory.
  useEffect(() => () => {
    for (const m of meshes.current.values()) {
      m.geometry.dispose();
      groupRef.current?.remove(m);
    }
    for (const m of waters.current.values()) {
      m.geometry.dispose();
      groupRef.current?.remove(m);
    }
    meshes.current.clear();
    waters.current.clear();
    material.dispose();
    waterMat.dispose();
  }, [material, waterMat]);

  useFrame(() => {
    if (!manifestReady || !groupRef.current) return;
    const mf = getManifest();
    if (!mf) return;

    const now = performance.now();
    if (now - lastEval.current < REEVAL_MS) return;
    lastEval.current = now;

    const maxDepth = Math.max(mf.maxLevel + DATA_LAG, MAX_RENDER_DEPTH);
    const cam = camera.position;
    const centre = new Float64Array(3);
    const next: NodeId[] = [];
    const nowSplit = new Set<string>();

    // Traverse the six roots, splitting toward the camera.
    const visit = (n: NodeId) => {
      // Backstop against a runaway subdivision: at these scales the ratio test should keep
      // the count in the low hundreds, so blowing past this means a maths bug, not a view.
      if (next.length > MAX_LEAVES) { next.push(n); return; }

      const key = idKey(n);
      nodeCentre(n, centre);
      const cx = centre[0] * PLANET_RADIUS, cy = centre[1] * PLANET_RADIUS, cz = centre[2] * PLANET_RADIUS;
      const dist = Math.max(1, Math.hypot(cam.x - cx, cam.y - cy, cam.z - cz));
      const ratio = tileArcUnits(n.depth) / dist;

      // Hysteresis: a node already split holds on down to MERGE_RATIO; a leaf must clear
      // the higher SPLIT_RATIO to divide. Equal thresholds would thrash at the boundary.
      const threshold = splitNodes.current.has(key) ? MERGE_RATIO : SPLIT_RATIO;

      if (n.depth < maxDepth && ratio > threshold && childrenReady(n, mf.maxLevel)) {
        nowSplit.add(key);
        for (let c = 0; c < 4; c++) {
          visit({ face: n.face, depth: n.depth + 1, x: n.x * 2 + (c & 1), y: n.y * 2 + (c >> 1) });
        }
        return;
      }
      next.push(n);
    };
    for (let f = 0; f < 6; f++) visit({ face: f, depth: 0, x: 0, y: 0 });

    splitNodes.current = nowSplit;
    const wanted = new Set(next.map(idKey));
    leafKeys.current = wanted;

    // Retire meshes that are no longer leaves.
    for (const [key, mesh] of meshes.current) {
      if (wanted.has(key)) continue;
      groupRef.current.remove(mesh);
      mesh.geometry.dispose();
      meshes.current.delete(key);
      const w = waters.current.get(key);
      if (w) { groupRef.current.remove(w); w.geometry.dispose(); waters.current.delete(key); }
    }

    // Build missing leaves through the shared budget so a burst never stalls a frame.
    for (const n of next) {
      const key = idKey(n);
      if (meshes.current.has(key) || building.current.has(key)) continue;
      const d = dataFor(n, mf.maxLevel);
      if (!hasTile(n.face, d.level, d.tx, d.ty)) { void requestTile(n.face, d.level, d.tx, d.ty); continue; }

      building.current.add(key);
      enqueueJob(`earth:${key}`, () => {
        building.current.delete(key);
        // The node may have merged away while queued. Set lookup, not a scan: this runs
        // once per queued patch and a linear search would make it quadratic.
        if (!leafKeys.current.has(key)) return true;
        const built = buildPatchGeometry(n, mf.maxLevel);
        if (!built) return true;
        const mesh = new THREE.Mesh(built.geo, material);
        mesh.frustumCulled = true;
        meshes.current.set(key, mesh);
        groupRef.current?.add(mesh);
        if (built.water) {
          const wm = new THREE.Mesh(built.water, waterMat);
          wm.frustumCulled = true;
          wm.renderOrder = 2;          // after opaque terrain
          waters.current.set(key, wm);
          groupRef.current?.add(wm);
        }
        if (!readyFired.current && meshes.current.size >= 6) {
          readyFired.current = true;
          console.log(`[earth] first patches built (${meshes.current.size}); planet is in the scene`);
          onReady?.();
        }
        return true;
      });
    }
  });

  return <group ref={groupRef} name="globe-terrain" />;
}
