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
import { toRenderSpace, toRenderX, toRenderY, toRenderZ } from '@/lib/renderSpace';
import { enqueueJob } from '@/lib/budgetedWork';
import {
  CELL_M, SAMPLES, SAMPLE_M, cellKey, cellOf, getHeight, getSampleAt,
  setBaseline, clearField, consumeDirtyCells, loadField,
} from './heightField';
import { loadMap } from './mapPersistence';
import { setBrushState } from './terrainBrushState';

const VIEW_CELLS = 3;          // load radius in cells (3×128 = 384 m of editable detail) — mobile-friendly
const TEX_REPEAT_M = 6;
const KEY_OFF = 32768;         // matches heightField cellKey packing

// Height/slope tint so sculpted hills read clearly (grass → rock on height + steepness).
const GRASS = new THREE.Color(0x5c7a3a);
const GRASS_HI = new THREE.Color(0x6f8a48);
const ROCK = new THREE.Color(0x6d6660);
const scratchColor = new THREE.Color(); // reused — no per-vertex/per-frame allocation
function tint(y: number, base: number, slopeUp: number, out: THREE.Color) {
  out.lerpColors(GRASS, GRASS_HI, Math.min(1, Math.max(0, (y - base) / 40)));
  if (slopeUp < 0.82) out.lerp(ROCK, Math.min(1, (0.82 - slopeUp) / 0.5));
}

export function HeightmapTerrain({ world, onReady }: { world: WorldDefinition; onReady?: () => void }) {
  const baseY = world.ground.surfaceY ?? 0;
  const groupRef = useRef<THREE.Group>(null);
  const loaded = useRef(new Map<number, THREE.Mesh>());

  const grass = useMemo(() => {
    const t = new THREE.TextureLoader().load('/siege/terrain/grass.png');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  // ONE material shared by every cell (vertex-colored) — not one per cell.
  const cellMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1, metalness: 0 }),
    [grass],
  );

  // Cell index range allowed by world bounds (null = unbounded).
  const range = useMemo(() => {
    const b = world.bounds;
    if (!b) return null;
    return { cx0: cellOf(b.min[0]), cx1: cellOf(b.max[0] - 1e-3), cz0: cellOf(b.min[1]), cz1: cellOf(b.max[1] - 1e-3) };
  }, [world.bounds]);

  // Base plane sitting just below baseline so the ground reads as infinite beyond the
  // streamed detail cells (the void edge otherwise). Detail cells render on top of it.
  const basePlane = useMemo(() => {
    const b = world.bounds;
    const minX = b ? b.min[0] : -10000, maxX = b ? b.max[0] : 10000;
    const minZ = b ? b.min[1] : -10000, maxZ = b ? b.max[1] : 10000;
    const sizeX = maxX - minX, sizeZ = maxZ - minZ;
    // Bake UVs into the geometry (world/6) so the SHARED grass texture stays at repeat
    // (1,1) — the detail cells depend on that for their own baked UVs.
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / TEX_REPEAT_M, pos.getY(i) / TEX_REPEAT_M);
    uv.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: grass, color: GRASS_HI, roughness: 1, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    const [rx, ry, rz] = toRenderSpace((minX + maxX) / 2, baseY - 0.1, (minZ + maxZ) / 2);
    m.position.set(rx, ry, rz);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  useEffect(() => {
    let alive = true;
    setBaseline(baseY);
    clearField();
    setBrushState({ waterOn: false }); // reset flood until the saved map (if any) loads
    setDynamicHeightProvider(getHeight);
    onReady?.();
    // Load any saved version of this map (local for now; server later — see mapPersistence).
    (async () => {
      const saved = await loadMap(world.id);
      if (!alive || !saved) return;
      loadField(saved.heightField);
      setBrushState({ waterOn: saved.water.on, waterLevel: saved.water.level });
      // Rebuild any cells already streamed so they reflect the loaded heights.
      for (const m of loaded.current.values()) { groupRef.current?.remove(m); m.geometry.dispose(); }
      loaded.current.clear();
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
    const colors = new Float32Array(SAMPLES * SAMPLES * 3);
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
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    paintColors(geo);
    return geo;
  };

  // Recolor from current heights + normals, in place (no allocation).
  const paintColors = (geo: THREE.BufferGeometry) => {
    const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal');
    const color = geo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < SAMPLES * SAMPLES; i++) {
      tint(pos.getY(i), baseY, normal.getY(i), scratchColor);
      color.setXYZ(i, scratchColor.r, scratchColor.g, scratchColor.b);
    }
    color.needsUpdate = true;
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
    paintColors(geo);
  };

  const addCell = (key: number, cx: number, cz: number) => {
    if (loaded.current.has(key) || !groupRef.current) return;
    const mesh = new THREE.Mesh(buildGeometry(cx, cz), cellMat);
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
    if (!groupRef.current) return;
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
  });

  return (
    <group ref={groupRef}>
      <primitive object={basePlane} />
    </group>
  );
}
