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
import { getHeight, setBaseline, consumeDirtyCells } from './terrain/heightField';

const VIEW_RINGS = 40;        // parcels drawn in every direction (~4 km disc)
const REBUILD_STEP = 8;       // rebuild only after crossing this many parcels
const TEX_REPEAT_M = 8;       // grass tiles every 8 m
// Rim (parcel border) appearance. These were first tuned in a bare test scene and were far too
// timid once the map ran under the engine's real lighting and SWW's fog: from standing height the
// honeycomb was invisible, which defeats the point of drawing it. Wider band, stronger mix, and a
// pale sand colour instead of a yellow-green that sat right on top of the grass.
// Halved twice over on 2026-Sep-04: the band was too wide and too white in game. Band width is
// (1 - EDGE_START), so 0.89 is half of the previous 0.78, and the mix strength is halved too.
const EDGE_START = 0.89;      // where the rim lightening begins, 0 = parcel centre, 1 = rim
const EDGE_STRENGTH = 0.45;   // how far the rim is pushed towards EDGE_COLOR
const EDGE_COLOR = new THREE.Color('#f4f1dc');
const GRASS_URL = '/grass_texture_seamless.webp';   // DreadRoot's own grass

function buildGeometry(centre: Hex, _surfaceY: number): THREE.BufferGeometry {
  const hexes = hexesWithin(centre, VIEW_RINGS);
  const n = hexes.length;
  const pos = new Float32Array(n * 7 * 3);
  const nor = new Float32Array(n * 7 * 3);
  const uv = new Float32Array(n * 7 * 2);
  const edge = new Float32Array(n * 7);
  const idx = new Uint32Array(n * 18);

  let v = 0, ii = 0;
  for (const h of hexes) {
    const c = hexToWorld(h.q, h.r);
    const base = v;
    for (let k = 0; k < 7; k++) {
      const wx = k === 0 ? c.x : c.x + HEX_CORNERS[k - 1].x;
      const wz = k === 0 ? c.z : c.z + HEX_CORNERS[k - 1].z;
      // Height comes from the shared sculptable heightfield, which is what lets the SWW terrain
      // brush work on this map: raise ground and the honeycomb rises with it.
      // Through the world→render boundary, like every other layer (identity today).
      const [rx, ry, rz] = toRenderSpace(wx, getHeight(wx, wz), wz);
      pos[v * 3] = rx; pos[v * 3 + 1] = ry; pos[v * 3 + 2] = rz;
      nor[v * 3] = 0; nor[v * 3 + 1] = 1; nor[v * 3 + 2] = 0;
      uv[v * 2] = wx / TEX_REPEAT_M; uv[v * 2 + 1] = wz / TEX_REPEAT_M;
      edge[v] = k === 0 ? 0 : 1;
      v++;
    }
    // Counter-clockwise seen from above so the front face points +Y. Winding is what three culls
    // on, NOT the normal attribute: wind these the other way and the world is invisible from above.
    for (let k = 0; k < 6; k++) {
      idx[ii++] = base;
      idx[ii++] = base + 1 + ((k + 1) % 6);
      idx[ii++] = base + 1 + k;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Standard material with the rim lightening patched into its albedo, so lighting stays normal. */
function makeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6f8f4e'), roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeStart = { value: EDGE_START };
    shader.uniforms.uEdgeStrength = { value: EDGE_STRENGTH };
    shader.uniforms.uEdgeColor = { value: EDGE_COLOR };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vEdge = aEdge;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform float uEdgeStart;\nuniform float uEdgeStrength;\nuniform vec3 uEdgeColor;\nvarying float vEdge;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
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
  // Bumped whenever the terrain brush edits a cell, which forces the honeycomb to rebuild.
  const [editEpoch, setEditEpoch] = useState(0);

  // Creation and disposal share one effect so a StrictMode / remount cycle cannot leave a
  // disposed material behind (which renders nothing, silently).
  useEffect(() => {
    const mat = makeMaterial();
    setMaterial(mat);
    let cancelled = false;
    new THREE.TextureLoader().load(GRASS_URL, (tex) => {
      if (cancelled) { tex.dispose(); return; }
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      mat.map = tex;
      mat.color.set('#ffffff');
      mat.needsUpdate = true;
    }, undefined, (e) => console.error('[Starblink] grass texture failed', e));
    return () => { cancelled = true; mat.map?.dispose(); mat.dispose(); setMaterial(null); };
  }, []);

  useEffect(() => {
    const g = buildGeometry(centre, surfaceY);
    setGeometry(g);
    return () => { g.dispose(); };
  }, [centre, surfaceY, editEpoch]);

  // The height contract the rest of the engine reads. Registering the heightfield sampler (rather
  // than one flat tile) means ground-follow, god mode, physics, monsters and coin drops all agree
  // with what the terrain brush has sculpted — and an untouched world still reads flat, because an
  // unedited heightfield returns its baseline everywhere.
  useEffect(() => {
    setBaseline(surfaceY);
    setDynamicHeightProvider(getHeight);
    onReady?.();
    return () => setDynamicHeightProvider(null);
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
