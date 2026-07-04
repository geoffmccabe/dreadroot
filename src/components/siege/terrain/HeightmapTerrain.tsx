// HeightmapTerrain — renders an editable map's terrain as one displaced grid mesh per
// 128 m cell, streamed by camera proximity (reusing the engine's budgeted work queue,
// the same load/unload-by-distance pattern as the voxel chunk loader). Cells build off
// the canonical heightField; edited cells rebuild live. Registers heightField.getHeight
// as the shared ground sampler so the player walks the sculpted ground immediately.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldDefinition } from '@/config/worldDefinition';
import { setDynamicHeightProvider } from '../terrainHeight';
import { toRenderX, toRenderY, toRenderZ } from '@/lib/renderSpace';
import { enqueueJob } from '@/lib/budgetedWork';
import {
  CELL_M, SAMPLES, SAMPLE_M, cellKey, cellOf, getHeight, getSampleAt,
  setBaseline, clearField, consumeDirtyCells, loadField,
} from './heightField';
import { loadMap } from './mapPersistence';
import { setBrushState } from './terrainBrushState';
import { setMapLoadStatus } from '../mapLoadStatus';
import { isSiegeLoadActive } from '../siegeInitLoad';
// Show the map-switch modal only for a Cmd-J switch — the initial lobby uses the full init overlay.
const announce = (m: string | null) => { if (!isSiegeLoadActive()) setMapLoadStatus(m); };
import { loadTerrainTex, makeTerrainBlendMaterial } from './terrainBlend';

const DEFAULT_VIEW_CELLS = 3;  // load radius in cells (3×128 = 384 m) — mobile-friendly default; world.ground.viewCells overrides
const TEX_REPEAT_M = 6;
const KEY_OFF = 32768;         // matches heightField cellKey packing

// Sand/grass/rock blend weights so sculpted hills read clearly — grass on flatish ground, rock on
// steep ground (no sand on editable maps; they have no fixed waterline). Written per-vertex into aWgt.
const SLOPE_ROCK = 0.82;
function cellWeights(slopeUp: number, out: Float32Array, i: number) {
  const rock = slopeUp < SLOPE_ROCK ? Math.min(1, (SLOPE_ROCK - slopeUp) / 0.5) : 0;
  out[i * 3] = 0; out[i * 3 + 1] = 1 - rock; out[i * 3 + 2] = rock;
}

export function HeightmapTerrain({ world, onReady }: { world: WorldDefinition; onReady?: () => void }) {
  const baseY = world.ground.surfaceY ?? 0;
  const groupRef = useRef<THREE.Group>(null);
  const loaded = useRef(new Map<number, THREE.Mesh>());
  const fieldReady = useRef(false);   // true once the saved/seed heightfield is loaded — gates streaming + onReady
  const readyFired = useRef(false);   // onReady fires exactly once, after the camera's cell is actually rendered

  // Night maps (SciFi City) darken the terrain toward black so it doesn't glow under the dark city;
  // the material colour multiplies the blended textures.
  const night = world.id === 'city-demo';
  const VIEW_CELLS = world.ground.viewCells ?? DEFAULT_VIEW_CELLS;   // per-world view radius (long view for builder islands)
  // ONE sand/grass/rock blend material shared by every cell — not one per cell.
  const cellMat = useMemo(
    () => makeTerrainBlendMaterial(
      loadTerrainTex('/sww_terrain_sand.webp'),
      loadTerrainTex('/sww_terrain_grass.webp'),
      loadTerrainTex('/sww_terrain_rock.webp'),
      { color: night ? new THREE.Color(0.3, 0.3, 0.3) : new THREE.Color(1, 1, 1) },
    ),
    [night],
  );

  // Cell index range allowed by world bounds (null = unbounded).
  const range = useMemo(() => {
    const b = world.bounds;
    if (!b) return null;
    return { cx0: cellOf(b.min[0]), cx1: cellOf(b.max[0] - 1e-3), cz0: cellOf(b.min[1]), cz1: cellOf(b.max[1] - 1e-3) };
  }, [world.bounds]);

  // Distance fog hides the edge of the streamed-cell ring (no overlapping "base plane",
  // which used to z-fight the flat cells → the white/black flashing, and blocked digging).
  // Cells fully fade into fog before their ~VIEW_CELLS×128 m edge.
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prevFog = scene.fog;
    // Night maps fade to dark, not the daytime light grey-blue (which washed the night city grey).
    scene.fog = new THREE.Fog(night ? 0x0a0e1a : 0x9fb2c4, VIEW_CELLS * CELL_M * 0.45, VIEW_CELLS * CELL_M * 0.95);
    return () => { scene.fog = prevFog; };
  }, [scene, night, VIEW_CELLS]);

  useEffect(() => {
    let alive = true;
    setBaseline(baseY);
    clearField();
    fieldReady.current = false;
    readyFired.current = false;
    announce('Loading Objects and Terrain');   // phase 1: pulling data into memory
    setBrushState({ waterOn: false }); // reset flood until the saved map (if any) loads
    setDynamicHeightProvider(getHeight);
    // Load the saved/seed heightfield FIRST, then signal ready — so the REAL terrain renders before
    // objects mount on top (instead of the old objects → flat → real morph). Streaming waits on this.
    (async () => {
      const saved = await loadMap(world.id);
      if (!alive) return;
      if (saved) {
        loadField(saved.heightField);
        setBrushState({ waterOn: saved.water.on, waterLevel: saved.water.level });
      } else if (world.ground.seedUrl) {
        // First load of a SEEDED map (no saved edits yet): pull the initial terrain + water.
        try {
          const seed = await (await fetch(world.ground.seedUrl)).json();
          if (!alive) return;
          loadField(seed);
          if (seed.water) setBrushState({ waterOn: !!seed.water.on, waterLevel: seed.water.level });
        } catch { /* seed missing → stay flat */ }
      }
      // Rebuild any cells already streamed so they reflect the loaded heights.
      for (const m of loaded.current.values()) { groupRef.current?.remove(m); m.geometry.dispose(); }
      loaded.current.clear();
      fieldReady.current = true;   // streaming can start; onReady fires once the camera's cell renders (useFrame)
      announce('Loading Terrain');   // phase 2: heightfield in memory, rendering the ground
    })();
    return () => {
      alive = false;
      setDynamicHeightProvider(null);
      clearField();
      for (const m of loaded.current.values()) { m.geometry.dispose(); }
      loaded.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id, baseY]);

  // Build a cell's geometry once (on stream-in). Allocation only happens here, never per frame.
  const buildGeometry = (cx: number, cz: number): THREE.BufferGeometry => {
    const verts = new Float32Array(SAMPLES * SAMPLES * 3);
    const uvs = new Float32Array(SAMPLES * SAMPLES * 2);
    const weights = new Float32Array(SAMPLES * SAMPLES * 3);
    const baseX = cx * CELL_M, baseZ = cz * CELL_M;
    for (let iz = 0; iz < SAMPLES; iz++) {
      for (let ix = 0; ix < SAMPLES; ix++) {
        const i = iz * SAMPLES + ix;
        const wx = baseX + ix * SAMPLE_M, wz = baseZ + iz * SAMPLE_M;
        verts[i * 3] = toRenderX(wx); verts[i * 3 + 1] = toRenderY(getSampleAt(wx, wz)); verts[i * 3 + 2] = toRenderZ(wz);
        uvs[i * 2] = wx / TEX_REPEAT_M; uvs[i * 2 + 1] = wz / TEX_REPEAT_M;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < SAMPLES - 1; iz++)
      for (let ix = 0; ix < SAMPLES - 1; ix++) {
        const a = iz * SAMPLES + ix, b = a + 1, c = a + SAMPLES, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aWgt', new THREE.BufferAttribute(weights, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    paintWeights(geo);
    geo.computeBoundingSphere();   // else frustum culling uses default/stale bounds
    return geo;
  };

  // Recompute sand/grass/rock weights from current normals, in place (no allocation).
  const paintWeights = (geo: THREE.BufferGeometry) => {
    const normal = geo.getAttribute('normal');
    const wgt = geo.getAttribute('aWgt') as THREE.BufferAttribute;
    const arr = wgt.array as Float32Array;
    for (let i = 0; i < SAMPLES * SAMPLES; i++) cellWeights(normal.getY(i), arr, i);
    wgt.needsUpdate = true;
  };

  // Brush feedback: update an existing cell's heights IN PLACE — only Y + normals + colors
  // change (X/Z/UV/index are fixed), so zero per-frame allocation while sculpting.
  const refreshGeometry = (geo: THREE.BufferGeometry, cx: number, cz: number) => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const baseX = cx * CELL_M, baseZ = cz * CELL_M;
    for (let iz = 0; iz < SAMPLES; iz++)
      for (let ix = 0; ix < SAMPLES; ix++) {
        const i = iz * SAMPLES + ix;
        pos.setY(i, toRenderY(getSampleAt(baseX + ix * SAMPLE_M, baseZ + iz * SAMPLE_M)));
      }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    paintWeights(geo);
    geo.computeBoundingSphere();   // sculpted heights changed → refresh cull bounds so it doesn't vanish
  };

  const addCell = (key: number, cx: number, cz: number) => {
    if (loaded.current.has(key) || !groupRef.current) return;
    const mesh = new THREE.Mesh(buildGeometry(cx, cz), cellMat);
    mesh.receiveShadow = true;   // catch the sun for 3D form
    mesh.castShadow = true;
    mesh.frustumCulled = false;  // few cells loaded at once; never let a sculpted cell cull out
    mesh.userData.ground = true;
    mesh.userData.terrainCell = key;
    groupRef.current.add(mesh);
    loaded.current.set(key, mesh);
  };

  const inRange = (cx: number, cz: number) =>
    !range || (cx >= range.cx0 && cx <= range.cx1 && cz >= range.cz0 && cz <= range.cz1);

  const cam = useThree((s) => s.camera);
  const dropScratch = useRef<number[]>([]); // reused each frame — no per-frame array alloc
  useFrame(() => {
    if (!groupRef.current || !fieldReady.current) return;   // wait for the heightfield → no flat-then-real morph
    const ccx = cellOf(cam.position.x), ccz = cellOf(cam.position.z);

    // Stream in nearby cells (staggered via the budgeted work queue).
    for (let cx = ccx - VIEW_CELLS; cx <= ccx + VIEW_CELLS; cx++)
      for (let cz = ccz - VIEW_CELLS; cz <= ccz + VIEW_CELLS; cz++) {
        if (!inRange(cx, cz)) continue;
        const key = cellKey(cx, cz);
        if (loaded.current.has(key)) continue;
        enqueueJob(`hmcell_${key}`, () => { addCell(key, cx, cz); return true; });
      }

    // Unload far cells (decode key → cell indices, inverse of cellKey).
    const drop = dropScratch.current; drop.length = 0;
    for (const key of loaded.current.keys()) {
      const cx = Math.floor(key / 65536) - KEY_OFF;
      const cz = (key % 65536) - KEY_OFF;
      if (Math.abs(cx - ccx) > VIEW_CELLS + 1 || Math.abs(cz - ccz) > VIEW_CELLS + 1) drop.push(key);
    }
    for (const key of drop) {
      const mesh = loaded.current.get(key)!;
      groupRef.current.remove(mesh);
      mesh.geometry.dispose();
      loaded.current.delete(key);
    }

    // Brush feedback: refresh edited cells IN PLACE (no geometry realloc, no GC churn).
    for (const key of consumeDirtyCells()) {
      const mesh = loaded.current.get(key);
      if (!mesh) continue;
      refreshGeometry(mesh.geometry, Math.floor(key / 65536) - KEY_OFF, (key % 65536) - KEY_OFF);
    }

    // Signal ready ONLY once the player's own cell has actually rendered — so objects mount on visible
    // terrain, not before it. (Cells stream via the budgeted queue, so this lands a few frames later.)
    if (fieldReady.current && !readyFired.current && loaded.current.has(cellKey(ccx, ccz))) {
      readyFired.current = true;
      announce(null);   // terrain is on screen — the object layer (if any) takes over the modal
      onReady?.();
    }
  });

  return <group ref={groupRef} />;
}
