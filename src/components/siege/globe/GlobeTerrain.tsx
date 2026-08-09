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
  PLANET_RADIUS, METRES_PER_UNIT, faceUvToDirection, tileArcUnits, tileUvRange,
} from './cubeSphere';
import {
  loadManifest, getManifest, getTile, hasTile, requestTile, sampleTileBilinear, clearEarthTiles,
} from './earthTiles';
import { detailMetres } from './globeDetail';
import { cityBaseMetres } from './cityGround';
import { sampleGlobeElevation } from './globeGround';
// PATCH, DATA_LAG, dataFor and the node-key helpers live in globePatchIndex so that the ground
// sampler and this mesh builder cannot drift apart. They used to be defined here and re-derived
// there, which is precisely how the surface you stand on ended up being a different height from
// the surface you see.
import {
  PATCH, DATA_LAG, MAX_RENDER_DEPTH, patchSpacingUnits, dataFor, idKey, parseKey, resolveLevel,
  notePatchBuilt, notePatchRemoved, clearPatchIndex, type NodeId,
} from './globePatchIndex';

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

/**
 * Longest a superseded patch may be held on screen while its replacements build.
 *
 * Long enough to cover a normal build (a few frames), short enough that a replacement which never
 * arrives cannot leave a smoothed copy of the landscape sitting over the real one indefinitely.
 */
const STALE_HOLD_MS = 2500;

/**
 * Hard cap on visible patches.
 *
 * Lowered from 600 after the water layer roughly DOUBLED per-patch memory: at 600 leaves that was
 * ~315 MB of GPU buffers, which exhausted the WebGL context and crashed the map to a white screen.
 * With the shared index and this cap it is about 80 MB.
 */
const MAX_LEAVES = 300;

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
 *
 * (MAX_RENDER_DEPTH itself is defined in globePatchIndex, alongside PATCH and DATA_LAG, so the
 * ground sampler searches exactly the range this tree can produce.)
 */

/** Skirt depth as a fraction of patch arc: hides cracks where LOD levels meet. */
const SKIRT_FRAC = 0.03;

/**
 * Live terrain diagnostics, so "the planet has disappeared" can be answered by LOOKING rather than
 * by guessing. Three failed guesses at this bug is three too many, and each of the plausible
 * causes leaves a different fingerprint here:
 *   patches 0, wanted 0   -> the tree evaluated to nothing (LOD/traversal)
 *   patches 0, wanted > 0 -> it wants them but they will not BUILD (tile data)
 *   patches > 0           -> geometry exists and the problem is the CAMERA (near/far, clipping)
 */
export const terrainDiag = {
  patches: 0, wanted: 0, deepest: 0, altitudeUnits: 0, near: 0, far: 0, evals: 0,
};

/** Do these two nodes cover any of the same ground? True when one contains the other. */
function overlaps(a: NodeId, b: NodeId): boolean {
  if (a.face !== b.face) return false;
  const [hi, lo] = a.depth <= b.depth ? [a, b] : [b, a];
  const shift = lo.depth - hi.depth;
  return (lo.x >> shift) === hi.x && (lo.y >> shift) === hi.y;
}

/**
 * ONE index buffer, shared by every patch and both layers.
 *
 * Every patch has identical topology, so this used to upload the same 102 KB triangle list once
 * per patch. At the leaf cap with terrain and water that was 120 MB of duplicated GPU memory,
 * a large part of what exhausted the WebGL context and crashed the map to white.
 */
let _index: THREE.BufferAttribute | null = null;
function sharedIndex(): THREE.BufferAttribute {
  if (_index) return _index;
  const side = PATCH + 2;
  const a = new Uint32Array((side - 1) * (side - 1) * 6);
  let w = 0;
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const v = j * side + i, b = v + 1, c = v + side, e = c + 1;
      a[w++] = v; a[w++] = c; a[w++] = b;
      a[w++] = b; a[w++] = c; a[w++] = e;
    }
  }
  _index = new THREE.BufferAttribute(a, 1);
  return _index;
}

/**
 * Lower the outer ring toward the planet centre, AFTER normals are computed.
 *
 * The skirt hides cracks where neighbouring patches sit at different LOD levels. It has to exist,
 * but it must not participate in normal calculation: its near-vertical triangles drag the edge
 * normals sideways, and since both patches at a boundary do the same thing the result is a bright
 * or dark crease along every patch edge across the whole planet.
 */
function dropSkirt(pos: Float32Array, side: number, drop: number): void {
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      if (j !== 0 && j !== side - 1 && i !== 0 && i !== side - 1) continue;
      const k = (j * side + i) * 3;
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const len = Math.hypot(x, y, z);
      if (len < 1e-6) continue;
      const f = (len - drop) / len;
      pos[k] = x * f; pos[k + 1] = y * f; pos[k + 2] = z * f;
    }
  }
}

/** Dispose a patch WITHOUT freeing the shared index, which every other patch still uses. */
function disposePatch(geo: THREE.BufferGeometry): void {
  geo.setIndex(null);
  geo.dispose();
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
function buildPatchGeometry(
  n: NodeId, maxLevel: number,
): { geo: THREE.BufferGeometry; water: THREE.BufferGeometry | null; level: number } | null {
  const lvl = resolveLevel(n, maxLevel);
  if (lvl < 0) return null;                       // nothing resident yet; try again next pass
  const d = dataFor(n, maxLevel, lvl);
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
  const patchSpacing = patchSpacingUnits(n.depth);
  // Same spacing in real metres, used to turn a height difference into a slope for shading.
  const spacingM = patchSpacing * METRES_PER_UNIT;
  let prevM = 0;

  for (let j = 0; j < side; j++) {
    // Clamp into the patch for the skirt ring, so skirt verts sit under the true edge.
    const jj = j === 0 ? 0 : j === side - 1 ? PATCH - 1 : j - 1;
    const isSkirtRow = j === 0 || j === side - 1;
    for (let i = 0; i < side; i++) {
      const ii = i === 0 ? 0 : i === side - 1 ? PATCH - 1 : i - 1;
      const isSkirt = isSkirtRow || i === 0 || i === side - 1;

      faceUvToDirection(n.face, u0 + ii * du, v0 + jj * dv, dir);
      // THROUGH cityBaseMetres — the same call the ground sampler and the patch index make.
      //
      // RE-APPLIED after a revert took it out with an unrelated change, and the symptom is worth
      // recording: the sampler and the patch index still said Dubai was at +6 m while the MESH went
      // back to drawing it at -87 m. Ninety-three metres between where the ground is drawn and where
      // the Kaiju stands on it. This is the third time these three have had to be kept in step, and
      // every time they drift the failure looks like something else entirely.
      const baseM = cityBaseMetres(dir[0], dir[1], dir[2],
        sampleTileBilinear(tile, d.ox + ii * d.stride, d.oy + jj * d.stride)) ?? 0;
      // Procedural amplification: the measured data is one sample per 2.44 km, which is a flat
      // plane at creature scale. This adds the detail no global dataset can supply, band-limited
      // to what this patch can represent. Same function the ground sampler uses, so the Kaiju
      // stands on exactly the surface you can see.
      const metres = baseM + detailMetres(dir[0], dir[1], dir[2], PLANET_RADIUS, baseM, patchSpacing);
      // TRUE elevation, including below sea level: the seafloor is real geometry you can swim
      // over. It used to be clamped up to sea level to stop an OPAQUE ocean shell z-fighting it,
      // but that shell is gone. The water surface is now built as a separate translucent layer in
      // this same patch (see below) which never writes depth, so it cannot fight anything.
      // NOTE: no skirt drop here. The skirt ring is lowered AFTER normals are computed, because
      // including near-vertical skirt triangles in computeVertexNormals corrupts the normal of
      // every edge vertex, and a wrong normal on both sides of a patch boundary is exactly the
      // visible seam that appears across the planet at each LOD level.
      const r = PLANET_RADIUS + metres / METRES_PER_UNIT;

      const k = (j * side + i) * 3;
      pos[k] = toRenderX(dir[0] * r);
      pos[k + 1] = toRenderY(dir[1] * r);
      pos[k + 2] = toRenderZ(dir[2] * r);

      // --- surface colour -------------------------------------------------------------------
      // There are no texture maps yet (that is the biome work in P3), so all of the visual
      // variety has to come from per-vertex colour. Flat elevation banding alone reads as poster
      // paint, so this combines four signals: LATITUDE for the biome, ELEVATION for treeline and
      // snow, SLOPE so cliffs go to bare rock, and a little NOISE so nothing is a flat plate.
      const sinLat = dir[1];
      const absLat = Math.abs(sinLat);
      let r0: number, g0: number, b0: number;

      if (metres < 0) {
        // Shallow shelf -> bright blue, abyss -> near-black. -6000 m covers most of the ocean.
        const t = Math.min(1, -metres / 6000);
        r0 = 0.10 - 0.07 * t; g0 = 0.32 - 0.24 * t; b0 = 0.55 - 0.32 * t;
      } else {
        // Biome by latitude band, roughly Earth's: rainforest, desert belt, temperate, boreal, ice.
        const l = Math.asin(Math.min(1, absLat)) * 180 / Math.PI;
        let br: number, bg: number, bb: number;
        if (l < 12)      { br = 0.16; bg = 0.38; bb = 0.14; }        // equatorial forest
        else if (l < 32) { const t = (l - 12) / 20; br = 0.16 + 0.50 * t; bg = 0.38 + 0.20 * t; bb = 0.14 + 0.16 * t; }  // -> desert
        else if (l < 48) { const t = (l - 32) / 16; br = 0.66 - 0.42 * t; bg = 0.58 - 0.14 * t; bb = 0.30 - 0.12 * t; }  // -> temperate
        else if (l < 66) { const t = (l - 48) / 18; br = 0.24 - 0.06 * t; bg = 0.44 - 0.10 * t; bb = 0.18 + 0.02 * t; }  // -> boreal
        else             { const t = Math.min(1, (l - 66) / 14); br = 0.18 + 0.72 * t; bg = 0.34 + 0.58 * t; bb = 0.20 + 0.74 * t; } // -> ice

        // Slope from the height difference to the neighbour already computed this row. Steep
        // ground loses its vegetation and goes to bare rock, which is what actually makes
        // mountains read as mountains rather than green lumps.
        const dh = Math.abs(metres - prevM);
        prevM = metres;
        const slope = Math.min(1, dh / Math.max(1, spacingM * 0.55));
        const rock = slope * 0.85;
        br = br * (1 - rock) + 0.42 * rock;
        bg = bg * (1 - rock) + 0.39 * rock;
        bb = bb * (1 - rock) + 0.36 * rock;

        // Treeline then snowline, both dropping toward the poles.
        const treeLine = 3200 - 2600 * absLat * absLat;
        const snowLine = 4600 - 4100 * absLat * absLat;
        if (metres > treeLine) {
          const t = Math.min(1, (metres - treeLine) / Math.max(1, snowLine - treeLine));
          br = br * (1 - t) + 0.46 * t; bg = bg * (1 - t) + 0.43 * t; bb = bb * (1 - t) + 0.40 * t;
        }
        if (metres > snowLine) {
          const t = Math.min(1, (metres - snowLine) / 900);
          br = br * (1 - t) + 0.95 * t; bg = bg * (1 - t) + 0.96 * t; bb = bb * (1 - t) + 0.98 * t;
        }

        // Fine variation so large flat regions are not one solid colour. Cheap hash on the
        // direction; deterministic, so it does not shimmer between frames or LOD levels.
        const nx = (dir[0] * 8192) | 0, ny = (dir[1] * 8192) | 0, nz = (dir[2] * 8192) | 0;
        let hsh = Math.imul(nx * 374761393 + ny * 668265263 + nz * 2147483647, 1274126177);
        hsh = (hsh ^ (hsh >>> 15)) >>> 0;
        const v = 1 + ((hsh / 4294967295) - 0.5) * 0.16;
        br *= v; bg *= v; bb *= v;

        r0 = br; g0 = bg; b0 = bb;
      }
      col[k] = r0; col[k + 1] = g0; col[k + 2] = b0;

      // Water vertex: always at sea level. Alpha ramps from clear at the shoreline to nearly
      // opaque by ~120 m depth, which gives soft beaches instead of a hard blue edge, and hides
      // the seafloor from orbit the way a real ocean does.
      const wr = PLANET_RADIUS;
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

  const index = sharedIndex();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();      // on the TRUE surface, before the skirt is lowered
  dropSkirt(pos, side, skirtDrop);
  geo.computeBoundingSphere();

  let water: THREE.BufferGeometry | null = null;
  if (anyOcean) {
    water = new THREE.BufferGeometry();
    water.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    water.setAttribute('color', new THREE.BufferAttribute(wcol, 4));
    water.setIndex(index);
    water.computeVertexNormals();
    dropSkirt(wpos, side, skirtDrop);
    water.computeBoundingSphere();
  }
  // Report the data level this geometry was ACTUALLY made from. The caller used to re-run
  // resolveLevel afterwards, which can return a finer level if a tile arrived while the patch was
  // queued — recording a level the geometry does not match, and so a ground height that does not
  // match either.
  return { geo, water, level: lvl };
}

/**
 * May this node split?
 *
 * Only requires that SOME tile covers each child, which resolveLevel guarantees once level 0 is
 * in. The ideal (finest) tiles are requested so real detail sharpens in when it arrives, but a
 * missing one no longer blocks subdivision: procedural detail does not need tiles, and blocking
 * on them is what made the entire planet outside the landmark regions render flat.
 */
function childrenReady(n: NodeId, maxLevel: number): boolean {
  let ready = true;
  for (let c = 0; c < 4; c++) {
    const child: NodeId = { face: n.face, depth: n.depth + 1, x: n.x * 2 + (c & 1), y: n.y * 2 + (c >> 1) };
    const ideal = dataFor(child, maxLevel);
    if (!hasTile(child.face, ideal.level, ideal.tx, ideal.ty)) {
      void requestTile(child.face, ideal.level, ideal.tx, ideal.ty);
      // Fall back to any coarser resident tile rather than refusing to split.
      if (resolveLevel(child, maxLevel) < 0) ready = false;
    }
  }
  return ready;
}

export function GlobeTerrain({ onReady }: { onReady?: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const [manifestReady, setManifestReady] = useState(false);

  const meshes = useRef(new Map<string, THREE.Mesh>());
  /** Data level each built patch actually used, so it can be rebuilt when a better tile lands. */
  const builtLevel = useRef(new Map<string, number>());
  const waters = useRef(new Map<string, THREE.Mesh>());
  const leafKeys = useRef(new Set<string>());
  // Nodes that were SPLIT last evaluation. Hysteresis needs to know the previous state:
  // a split node stays split until it falls below MERGE_RATIO, while a leaf only splits
  // once it passes the higher SPLIT_RATIO. Without this the two thresholds do nothing.
  const splitNodes = useRef(new Set<string>());
  const building = useRef(new Set<string>());
  const lastEval = useRef(0);
  /** When each superseded patch first became stale, so it can be retired on a deadline. */
  const staleSince = useRef(new Map<string, number>());
  const readyFired = useRef(false);
  const warnedEmpty = useRef(false);

  const materials = useMemo(
    // fog:false — the sky system's exponential fog is opaque at planetary distances. GlobeCamera
    // nulls scene.fog each frame; this makes a stray frame harmless too.
    /**
     * TWO MATERIALS, ONE LIVE SWITCH.
     *
     * The lit (PBR) ground is the biggest visual change available and the riskiest — it replaces the
     * flattest material three.js has with an extended MeshStandardMaterial, which also responds to
     * scene lighting the old one ignored. So it is switchable from the Lightning Panel rather than a
     * decision baked in at build time, and BOTH are kept alive: flipping back is instant, and the
     * meshes already on screen are re-pointed at the other one below rather than being rebuilt.
     */
    () => ({
      flat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, fog: true }),
      lit: makeTerrainMaterial(METRES_PER_UNIT),
    }),
    [],
  );

  /**
   * WHICH MATERIAL IS IN USE RIGHT NOW, and re-point everything already built.
   *
   * Patches are plain THREE.Mesh objects created over many frames as the planet streams in, so
   * flipping the switch has to reach the ones that already exist — otherwise the ground would change
   * only where you have not been yet, which is worse than not changing at all.
   */
  const look = useGlobeLook();
  /** Read in the streaming loop, which runs outside React and must not close over a stale value. */
  const shadowsWanted = useRef(false);
  shadowsWanted.current = look.enabled && look.shadowsOn;
  useEffect(() => {
    for (const m of meshes.current.values()) {
      m.receiveShadow = shadowsWanted.current;
      m.castShadow = shadowsWanted.current;
    }
  }, [look.enabled, look.shadowsOn]);
  const material = look.enabled && look.terrainPbr ? materials.lit : materials.flat;
  useEffect(() => {
    for (const m of meshes.current.values()) m.material = material;
  }, [material]);

  // The panel's sliders go straight into the shader's uniforms — no rebuild, no recompile.
  useEffect(() => {
    const u = materials.lit.globeUniforms;
    u.uDetail.value = look.terrainDetail;
    u.uNormal.value = look.terrainNormal;
    u.uStrata.value = look.terrainStrata;
    u.uStrataM.value = look.terrainStrataM;
    u.uCavity.value = look.terrainCavity;
  }, [materials, look.terrainDetail, look.terrainNormal, look.terrainStrata,
      look.terrainStrataM, look.terrainCavity]);

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
      disposePatch(m.geometry);
      groupRef.current?.remove(m);
    }
    for (const m of waters.current.values()) {
      disposePatch(m.geometry);
      groupRef.current?.remove(m);
    }
    meshes.current.clear();
    waters.current.clear();
    // No patches on screen means no drawn ground to report; leaving stale entries would have the
    // sampler answering for a planet that is no longer mounted.
    clearPatchIndex();
    materials.flat.dispose();
    materials.lit.dispose();
    waterMat.dispose();
  }, [materials, waterMat]);

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

    // REVERTED to a plain recursive descent over the six roots.
    //
    // I replaced this with a priority queue that split the most urgent node first, to spend the
    // leaf budget nearest the camera. It was a real improvement where it applied — the Grand
    // Canyon went from 9 detailed patches to 18 — but it was a fix for a problem I never confirmed
    // was the one being reported, and since it landed the planet has failed to appear at startup
    // three separate times.
    //
    // A measured 2x in one place is not worth a planet that sometimes is not there. The version
    // below ran for weeks without that failure. The two terrain fixes that were CONFIRMED to help
    // — placing nodes at their real elevation, and retiring stale coarse patches on a deadline —
    // are both kept, because those were verified against the symptom rather than assumed.
    const visit = (n: NodeId) => {
      // Backstop against a runaway subdivision: at these scales the ratio test should keep
      // the count in the low hundreds, so blowing past this means a maths bug, not a view.
      if (next.length > MAX_LEAVES) { next.push(n); return; }

      const key = idKey(n);
      nodeCentre(n, centre);
      // Place the node at its REAL elevation, not at sea level. Standing on high ground otherwise
      // makes every tile read as further away than it is, which starved detail exactly where the
      // terrain is most dramatic.
      const nodeMetres = sampleGlobeElevation(centre[0], centre[1], centre[2]) ?? 0;
      const nodeRadius = PLANET_RADIUS + nodeMetres / METRES_PER_UNIT;
      const cx = centre[0] * nodeRadius, cy = centre[1] * nodeRadius, cz = centre[2] * nodeRadius;
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

    // Say so LOUDLY when the tree wants patches and none exist. This has been reported twice and
    // guessed at three times; a line in the console beats another round of speculation.
    if (terrainDiag.evals > 8 && meshes.current.size === 0 && next.length > 0 && !warnedEmpty.current) {
      warnedEmpty.current = true;
      console.warn(
        `[earth] NO PATCHES BUILT after ${terrainDiag.evals} evaluations: ${next.length} wanted, `
        + `altitude ${Math.round(cam.length() - PLANET_RADIUS)} u, `
        + `deepest level ${next.reduce((m, n) => Math.max(m, n.depth), 0)}. `
        + 'The tree is choosing nodes but their geometry is not being produced.',
      );
    }
    terrainDiag.evals++;
    terrainDiag.wanted = wanted.size;
    terrainDiag.patches = meshes.current.size;
    terrainDiag.deepest = next.reduce((m, n) => Math.max(m, n.depth), 0);
    terrainDiag.altitudeUnits = cam.length() - PLANET_RADIUS;
    const pc = camera as THREE.PerspectiveCamera;
    terrainDiag.near = pc.near ?? 0;
    terrainDiag.far = pc.far ?? 0;

    // Retire meshes that are no longer leaves, BUT ONLY once whatever replaces them exists.
    //
    // This is what made squares vanish into space while approaching the planet. A node that
    // splits stops being a leaf immediately, but its four children are built through the shared
    // 2 ms/frame budget and take several frames to appear. Removing the parent at once left
    // nothing covering that ground in between, and diving toward the surface splits many nodes at
    // once, so a whole neighbourhood of holes opened at exactly the moment you were looking at it.
    //
    // Holding the old patch until its replacements are ready costs a little transient memory and
    // some overdraw for a few frames. A hole through the planet costs the illusion entirely.
    for (const [key, mesh] of meshes.current) {
      if (wanted.has(key)) { staleSince.current.delete(key); continue; }
      const stale = parseKey(key);
      let replaced = true;
      for (const leaf of next) {
        if (leaf.face !== stale.face || !overlaps(leaf, stale)) continue;
        if (!meshes.current.has(idKey(leaf))) { replaced = false; break; }
      }
      // Safety valve: transitional patches are held, not leaked. If they pile up beyond the
      // budget (a very fast descent, or a patch that never builds), retire the oldest anyway
      // rather than run the GPU out of memory, which is what caused the earlier white screen.
      const overBudget = meshes.current.size > MAX_LEAVES * 1.6;

      // AND A DEADLINE, which is the important half.
      //
      // "Hold until every replacement exists" has no upper bound: if even ONE overlapping child
      // never builds — its data never resolves, or it is outside the leaf budget — the coarse
      // parent is held forever. A held parent is a SMOOTHED version of the same ground, so it
      // sits above the valleys and below the peaks of the real surface underneath it. That is
      // precisely what Geoff was seeing: a flat featureless plain with the true mountains reduced
      // to short bumps poking through, and a Kaiju that walks DOWN OFF the mountain and
      // disappears underneath the plain. The terrain was correct all along; a stale coarse copy
      // was being drawn over it indefinitely.
      const since = staleSince.current.get(key);
      if (since === undefined) staleSince.current.set(key, now);
      const heldTooLong = since !== undefined && now - since > STALE_HOLD_MS;

      if (!replaced && !overBudget && !heldTooLong) continue;   // replacement still building
      staleSince.current.delete(key);
      groupRef.current.remove(mesh);
      disposePatch(mesh.geometry);
      meshes.current.delete(key);
      builtLevel.current.delete(key);
      // Tell the ground sampler this patch is gone, or it would keep answering with a height for
      // terrain that is no longer drawn.
      notePatchRemoved(key);
      const w = waters.current.get(key);
      if (w) { groupRef.current.remove(w); disposePatch(w.geometry); waters.current.delete(key); }
    }

    // REBUILD patches that were built from a coarser fallback and can now do better.
    //
    // resolveLevel deliberately falls back to whatever tile is resident so the mesh can subdivide
    // before the ideal tile arrives. But nothing ever revisited that decision: a patch built from
    // level 4 while the level 10 tile was still downloading stayed at level 4 forever. Over the
    // Grand Canyon that means a smooth surface bridging the gorge, which is exactly the "canyon
    // filled with flat colour" it renders as. The real 1,424 m of relief is in the tile the client
    // already fetched; the mesh was simply never rebuilt from it.
    for (const n of next) {
      const rk = idKey(n);
      if (!meshes.current.has(rk) || building.current.has(rk)) continue;
      const was = builtLevel.current.get(rk);
      const now = resolveLevel(n, mf.maxLevel);
      if (was === undefined || now <= was) continue;
      building.current.add(rk);
      enqueueJob(`earth:rebuild:${rk}:${now}`, () => {
        building.current.delete(rk);
        if (!leafKeys.current.has(rk)) return true;
        const rebuilt = buildPatchGeometry(n, mf.maxLevel);
        if (!rebuilt) return true;
        const prev = meshes.current.get(rk);
        if (prev) { groupRef.current?.remove(prev); disposePatch(prev.geometry); }
        const mesh = new THREE.Mesh(rebuilt.geo, material);
        // The ground takes the Kaiju's shadow and throws its own — without the second, a ridge in
        // front of the sun still lights the valley behind it, which removes all sense of relief.
        mesh.receiveShadow = shadowsWanted.current;
        mesh.castShadow = shadowsWanted.current;
        mesh.frustumCulled = true;
        meshes.current.set(rk, mesh);
        groupRef.current?.add(mesh);
        const prevW = waters.current.get(rk);
        if (prevW) { groupRef.current?.remove(prevW); disposePatch(prevW.geometry); waters.current.delete(rk); }
        if (rebuilt.water) {
          const wm = new THREE.Mesh(rebuilt.water, waterMat);
          wm.frustumCulled = true; wm.renderOrder = 2;
          waters.current.set(rk, wm);
          groupRef.current?.add(wm);
        }
        builtLevel.current.set(rk, rebuilt.level);
        // Rebuilt from finer data: the ground moved, so the sampler must move with it.
        notePatchBuilt(n, rebuilt.level);
        return true;
      });
    }

    // Build missing leaves NEAREST FIRST. The budget only builds a couple of patches per frame,
    // so the order decides which ground is complete while you are looking at it.
    const pending = next.filter((n) => {
      const key = idKey(n);
      return !meshes.current.has(key) && !building.current.has(key);
    });
    pending.sort((a, b) => {
      nodeCentre(a, centre);
      const da = Math.hypot(cam.x - centre[0] * PLANET_RADIUS, cam.y - centre[1] * PLANET_RADIUS, cam.z - centre[2] * PLANET_RADIUS);
      nodeCentre(b, centre);
      const db = Math.hypot(cam.x - centre[0] * PLANET_RADIUS, cam.y - centre[1] * PLANET_RADIUS, cam.z - centre[2] * PLANET_RADIUS);
      return da - db;
    });
    for (const n of pending) {
      const key = idKey(n);
      // THE GATE HAS TO ASK FOR WHAT THE BUILDER ACTUALLY NEEDS.
      //
      // Geoff, at Dubai: "there's nothing at all. Just a big square hole in the terrain."
      //
      // This used to demand the IDEAL tile — dataFor(n, maxLevel) — and `continue` without it.
      // buildPatchGeometry does not need the ideal tile: it calls resolveLevel and builds from
      // whatever is resident, deliberately, so that ground outside a landmark region still has a
      // surface. The gate and the builder disagreed, and the gate won.
      //
      // Outside the 225 detail regions the ideal level is 5 or deeper and DOES NOT EXIST, so the
      // gate refused forever and the patch was never built at all. Not flat ground — no ground.
      // A square hole, exactly where the tree had subdivided far enough to want data that is not
      // there. The split logic had been fixed to fall back; this had not, so they disagreed about
      // what "ready" meant and the hole was the difference between them.
      if (resolveLevel(n, mf.maxLevel) < 0) continue;

      building.current.add(key);
      enqueueJob(`earth:${key}`, () => {
        building.current.delete(key);
        // The node may have merged away while queued. Set lookup, not a scan: this runs
        // once per queued patch and a linear search would make it quadratic.
        if (!leafKeys.current.has(key)) return true;
        const built = buildPatchGeometry(n, mf.maxLevel);
        if (!built) return true;
        const mesh = new THREE.Mesh(built.geo, material);
        mesh.receiveShadow = shadowsWanted.current;
        mesh.castShadow = shadowsWanted.current;
        mesh.frustumCulled = true;
        meshes.current.set(key, mesh);
        builtLevel.current.set(key, built.level);
        notePatchBuilt(n, built.level);
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
