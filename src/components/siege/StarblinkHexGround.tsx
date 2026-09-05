// StarblinkHexGround — the Starblink land world's ground: 90,307 hexagonal parcels, 100 m across
// the flats, tiled into one giant hexagon.
//
// It is the 'hexland' counterpart of FlatGroundLayer and honours the SAME contract, which is what
// makes the rest of the engine work here unchanged: it registers a flat HeightTile so
// sampleHeight() answers everywhere, so player ground-follow, god mode, coin drops, monsters and
// boulder physics all behave exactly as they do on any other siege map.
//
// Each parcel is its own little triangle fan (centre vertex plus 6 corners) so it can carry a
// per-vertex `aEdge` of 0 in the middle and 1 at the rim. The shader lightens the grass where
// aEdge is high, so neighbouring rims light up together and the honeycomb reads as a drawn grid.
// Parcels are deliberately NOT welded to each other; that edge value is why.
//
// Only a disc of parcels around the camera is built, rebuilt as the player crosses parcels. That
// is a placeholder for real per-cell streaming (docs/LAND_WORLD_PLAN.md §2e) and is cheap here:
// a 40-ring disc is about 30k triangles.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldDefinition } from '@/config/worldDefinition';
import { setDynamicHeightProvider } from './terrainHeight';
import { toRenderSpace } from '@/lib/renderSpace';
import { HEX_CORNERS, hexesWithin, hexToWorld, worldToHex, type Hex } from '@/features/starblink/hexGrid';
import { getHeight, setBaseline, consumeDirtyCells, setBaselineProvider } from './terrain/heightField';
import { terrainHeight } from '@/features/starblink/terrainGen';
import { useTerrainParams, getTerrainParams } from '@/features/starblink/terrainParams';

// Each parcel is subdivided into SUB concentric rings of triangles. A flat 7-vertex hexagon was
// fine while the world was flat, but terrain across a 100 m parcel needs interior vertices or
// mountains look like folded paper. SUB=3 gives 37 vertices and 54 triangles per parcel, about 25 m
// of terrain detail, and the view radius is traded down to keep the total honest: ring 26 is 2,107
// parcels, roughly 78k vertices.
//
// Subdivision is UNIFORM on purpose. Varying it by distance would be cheaper, but parcels at
// different levels do not share rim vertices, so their edges pull apart into visible cracks. Fixing
// that needs skirts or matched boundaries; worth doing, not worth doing first.
const SUB = 3;
const VIEW_RINGS = 26;        // parcels drawn in every direction (~2.6 km disc)
const REBUILD_STEP = 8;       // rebuild only after crossing this many parcels
const TEX_REPEAT_M = 8;       // grass tiles every 8 m
// Rim (parcel border) appearance. These were first tuned in a bare test scene and were far too
// timid once the map ran under the engine's real lighting and SWW's fog: from standing height the
// honeycomb was invisible, which defeats the point of drawing it. Wider band, stronger mix, and a
// pale sand colour instead of a yellow-green that sat right on top of the grass.
// Halved twice over on 2026-Sep-04: the band was too wide and too white in game. Band width is
// (1 - EDGE_START), so 0.89 is half of the previous 0.78, and the mix strength is halved too.
const EDGE_START = 0.89;      // where the rim lightening begins, 0 = parcel centre, 1 = rim
const EDGE_STRENGTH = 0.11;   // how far the rim is pushed towards EDGE_COLOR (a quarter of 0.45)
const EDGE_COLOR = new THREE.Color('#f4f1dc');

/** Vertices in one subdivided parcel: the centred hexagonal number, 1 + 3L(L+1). */
const VERTS_PER_HEX = 1 + 3 * SUB * (SUB + 1);
/** Triangles in one subdivided parcel. */
const TRIS_PER_HEX = 6 * SUB * SUB;

function buildGeometry(centre: Hex, _surfaceY: number): THREE.BufferGeometry {
  const hexes = hexesWithin(centre, VIEW_RINGS);
  const n = hexes.length;
  const pos = new Float32Array(n * VERTS_PER_HEX * 3);
  const nor = new Float32Array(n * VERTS_PER_HEX * 3);
  const uv = new Float32Array(n * VERTS_PER_HEX * 2);
  const edge = new Float32Array(n * VERTS_PER_HEX);
  const idx = new Uint32Array(n * TRIS_PER_HEX * 3);

  let v = 0, ii = 0;
  for (const h of hexes) {
    const c = hexToWorld(h.q, h.r);
    const base = v;

    // Lay the parcel out as concentric rings: the centre, then ring i with 6i vertices at i/SUB of
    // the way to the rim, walked corner to corner so consecutive rings stitch without gaps.
    const emit = (wx: number, wz: number, e: number) => {
      const [rx, ry, rz] = toRenderSpace(wx, getHeight(wx, wz), wz);
      pos[v * 3] = rx; pos[v * 3 + 1] = ry; pos[v * 3 + 2] = rz;
      nor[v * 3] = 0; nor[v * 3 + 1] = 1; nor[v * 3 + 2] = 0;   // replaced by computeVertexNormals
      uv[v * 2] = wx / TEX_REPEAT_M; uv[v * 2 + 1] = wz / TEX_REPEAT_M;
      edge[v] = e;
      v++;
    };

    emit(c.x, c.z, 0);                                  // ring 0: the centre
    for (let i = 1; i <= SUB; i++) {
      const f = i / SUB;
      for (let sct = 0; sct < 6; sct++) {
        const A = HEX_CORNERS[sct], B = HEX_CORNERS[(sct + 1) % 6];
        for (let j = 0; j < i; j++) {
          const t = j / i;
          emit(c.x + f * (A.x + (B.x - A.x) * t), c.z + f * (A.z + (B.z - A.z) * t), f);
        }
      }
    }

    // Stitch each ring to the one inside it, counter-clockwise seen from above so the front face
    // points +Y. Wind these the other way and the whole world is invisible from above.
    let inner = base;                 // first index of ring i-1
    let outer = base + 1;             // first index of ring i
    for (let i = 1; i <= SUB; i++) {
      const nIn = i === 1 ? 1 : 6 * (i - 1);
      const nOut = 6 * i;
      for (let sct = 0; sct < 6; sct++) {
        for (let j = 0; j < i; j++) {
          const a1 = outer + ((sct * i + j) % nOut);
          const b1 = outer + ((sct * i + j + 1) % nOut);
          const ci = i === 1 ? inner : inner + ((sct * (i - 1) + j) % nIn);
          idx[ii++] = ci; idx[ii++] = b1; idx[ii++] = a1;
          if (j < i - 1) {
            const di = inner + ((sct * (i - 1) + j + 1) % nIn);
            idx[ii++] = ci; idx[ii++] = di; idx[ii++] = b1;
          }
        }
      }
      inner = outer; outer += nOut;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();   // real lighting on the hills instead of everything facing straight up

  // Steepness per vertex, straight off the normals we just computed: 0 flat, 1 vertical. Doing it
  // here costs one pass over an array we already have, and saves four extra noise evaluations per
  // vertex that sampling the generator for a gradient would have cost.
  const nAttr = g.getAttribute('normal') as THREE.BufferAttribute;
  const slope = new Float32Array(nAttr.count);
  for (let i = 0; i < nAttr.count; i++) slope[i] = 1 - Math.abs(nAttr.getY(i));
  g.setAttribute('aSlope', new THREE.BufferAttribute(slope, 1));

  g.computeBoundingSphere();
  return g;
}

/**
 * Ground bands by elevation, in metres. Low flat ground is green; it dries to tan, then to brown
 * earth, then bare rock on the tops. Transitions are eased, so there are no hard stripes.
 */
const BAND_GRASS_TOP = 70;    // green up to here
const BAND_SAND_TOP = 165;    // tan
const BAND_BROWN_TOP = 275;   // brown earth; rock above

/** Steep ground is rock whatever its height, which is what makes cliffs and canyon walls read. */
const SLOPE_ROCK_START = 0.30;   // 1 - |normal.y|; about 25 degrees
const SLOPE_ROCK_FULL = 0.62;    // about 50 degrees

const TEX = {
  grass: '/sww_terrain_grass.webp',
  sand: '/sww_terrain_sand.webp',
  brown: '/cliff_texture_seamless.webp',
  rock: '/sww_terrain_rock.webp',
};

function loadTiling(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Four ground textures blended in the fragment shader by world height and steepness, with the
 * parcel-rim lightening layered on top. Blending in the shader rather than baking weights into a
 * vertex attribute means the bands stay smooth across a 100 m parcel instead of stepping at each
 * vertex, and re-tuning the bands is a uniform change rather than a mesh rebuild.
 */
function makeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.map = loadTiling(TEX.grass);   // gives the shader its UV plumbing; overridden below
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeStart = { value: EDGE_START };
    shader.uniforms.uEdgeStrength = { value: EDGE_STRENGTH };
    shader.uniforms.uEdgeColor = { value: EDGE_COLOR };
    shader.uniforms.uSand = { value: loadTiling(TEX.sand) };
    shader.uniforms.uBrown = { value: loadTiling(TEX.brown) };
    shader.uniforms.uRock = { value: loadTiling(TEX.rock) };
    shader.uniforms.uBands = { value: new THREE.Vector3(BAND_GRASS_TOP, BAND_SAND_TOP, BAND_BROWN_TOP) };
    shader.uniforms.uSlopeBand = { value: new THREE.Vector2(SLOPE_ROCK_START, SLOPE_ROCK_FULL) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aEdge;\nattribute float aSlope;\nvarying float vEdge;\nvarying float vSlope;\nvarying float vGroundY;')
      .replace('#include <uv_vertex>',
        '#include <uv_vertex>\n  vEdge = aEdge;\n  vSlope = aSlope;\n  vGroundY = position.y;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform float uEdgeStart;\nuniform float uEdgeStrength;\nuniform vec3 uEdgeColor;\n'
        + 'uniform sampler2D uSand;\nuniform sampler2D uBrown;\nuniform sampler2D uRock;\n'
        + 'uniform vec3 uBands;\nuniform vec2 uSlopeBand;\n'
        + 'varying float vEdge;\nvarying float vSlope;\nvarying float vGroundY;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        // Height bands, each eased into the next so there are no stripes.
        vec3 _grass = diffuseColor.rgb;
        vec3 _sand  = texture2D( uSand,  vMapUv ).rgb;
        vec3 _brown = texture2D( uBrown, vMapUv ).rgb;
        vec3 _rockc = texture2D( uRock,  vMapUv ).rgb;
        float _h = vGroundY;
        vec3 _c = mix( _grass, _sand,  smoothstep( uBands.x * 0.55, uBands.x, _h ) );
        _c = mix( _c, _brown, smoothstep( uBands.y * 0.8, uBands.y, _h ) );
        _c = mix( _c, _rockc, smoothstep( uBands.z * 0.85, uBands.z, _h ) );
        // Steep ground is rock at any height: this is what makes cliffs and canyon walls read.
        _c = mix( _c, _rockc, smoothstep( uSlopeBand.x, uSlopeBand.y, vSlope ) );
        diffuseColor.rgb = _c;

        float _b = smoothstep( uEdgeStart, 1.0, vEdge ) * uEdgeStrength;
        diffuseColor.rgb = mix( diffuseColor.rgb, uEdgeColor, _b );
      `);
  };
  return mat;
}

export function StarblinkHexGround({ world, onReady }: { world: WorldDefinition; onReady?: () => void }) {
  const surfaceY = world.ground.surfaceY ?? 0;
  const [centre, setCentre] = useState<Hex>({ q: 0, r: 0 });
  const [material, setMaterial] = useState<THREE.MeshStandardMaterial | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const built = useRef<Hex>({ q: 0, r: 0 });
  const tp = useTerrainParams();   // re-render (and rebuild) whenever a dial moves
  // The whole landscape, as a function. Unedited ground reads from here; brush edits stay as sparse
  // overrides on top, so an untouched 900 km2 world stores nothing at all.
  //
  // Registered during RENDER rather than in an effect, and that is not stylistic. Effects run in
  // declaration order, and the geometry effect below is declared FIRST, so registering the baseline
  // in a later effect meant the first mesh was built against a flat world and only picked up the
  // terrain once the player had walked eight parcels. This is an idempotent module-level setter.
  setBaselineProvider((x, z) => surfaceY + terrainHeight(x, z, getTerrainParams()));

  // Bumped whenever the terrain brush edits a cell, which forces the honeycomb to rebuild.
  const [editEpoch, setEditEpoch] = useState(0);

  // Creation and disposal share one effect so a StrictMode / remount cycle cannot leave a
  // disposed material behind (which renders nothing, silently).
  useEffect(() => {
    const mat = makeMaterial();
    setMaterial(mat);
    // The material loads its own four textures now, so there is no separate load to wait on.
    return () => { mat.map?.dispose(); mat.dispose(); setMaterial(null); };
  }, []);

  useEffect(() => {
    const g = buildGeometry(centre, surfaceY);
    setGeometry(g);
    return () => { g.dispose(); };
  }, [centre, surfaceY, editEpoch, tp]);

  // The height contract the rest of the engine reads. Registering the heightfield sampler (rather
  // than one flat tile) means ground-follow, god mode, physics, monsters and coin drops all agree
  // with what the terrain brush has sculpted — and an untouched world still reads flat, because an
  // unedited heightfield returns its baseline everywhere.
  useEffect(() => {
    setBaseline(surfaceY);
    setDynamicHeightProvider(getHeight);
    onReady?.();
    return () => { setDynamicHeightProvider(null); setBaselineProvider(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id, surfaceY]);

  useFrame(({ camera }) => {
    // The brush marks edited cells dirty; draining that queue is how a sculpt shows up here.
    if (consumeDirtyCells().length) setEditEpoch((n) => n + 1);
    const h = worldToHex(camera.position.x, camera.position.z);
    const moved = Math.max(
      Math.abs(h.q - built.current.q),
      Math.abs(h.r - built.current.r),
      Math.abs(h.q + h.r - built.current.q - built.current.r),
    );
    if (moved >= REBUILD_STEP) { built.current = h; setCentre(h); }
  });

  if (!geometry || !material) return null;
  return <mesh geometry={geometry} material={material} frustumCulled />;
}
