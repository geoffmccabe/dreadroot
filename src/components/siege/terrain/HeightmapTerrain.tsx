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
import { toRenderSpace } from '@/lib/renderSpace';
import { enqueueJob } from '@/lib/budgetedWork';
import {
  CELL_M, SAMPLES, SAMPLE_M, cellKey, cellOf, getHeight, getSampleAt,
  setBaseline, clearField, consumeDirtyCells, loadField,
} from './heightField';
import { registerTerrainMesh, unregisterTerrainMesh } from './terrainMeshRegistry';
import { loadMap } from './mapPersistence';
import { setBrushState } from './terrainBrushState';

const VIEW_CELLS = 4;          // load radius in cells (4×128 = 512 m of editable detail)
const TEX_REPEAT_M = 6;

// Height/slope tint so sculpted hills read clearly (grass → rock on height + steepness).
const GRASS = new THREE.Color(0x5c7a3a);
const GRASS_HI = new THREE.Color(0x6f8a48);
const ROCK = new THREE.Color(0x6d6660);
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
      for (const m of loaded.current.values()) { groupRef.current?.remove(m); unregisterTerrainMesh(m); m.geometry.dispose(); }
      loaded.current.clear();
    })();
    return () => {
      alive = false;
      setDynamicHeightProvider(null);
      clearField();
      for (const m of loaded.current.values()) { unregisterTerrainMesh(m); m.geometry.dispose(); }
      loaded.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id, baseY]);

  const buildGeometry = (cx: number, cz: number): THREE.BufferGeometry => {
    const verts = new Float32Array(SAMPLES * SAMPLES * 3);
    const uvs = new Float32Array(SAMPLES * SAMPLES * 2);
    const baseX = cx * CELL_M, baseZ = cz * CELL_M;
    for (let iz = 0; iz < SAMPLES; iz++) {
      for (let ix = 0; ix < SAMPLES; ix++) {
        const i = iz * SAMPLES + ix;
        const wx = baseX + ix * SAMPLE_M, wz = baseZ + iz * SAMPLE_M;
        const [rx, ry, rz] = toRenderSpace(wx, getSampleAt(wx, wz), wz);
        verts[i * 3] = rx; verts[i * 3 + 1] = ry; verts[i * 3 + 2] = rz;
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const normal = geo.getAttribute('normal');
    const colors = new Float32Array(SAMPLES * SAMPLES * 3);
    const c = new THREE.Color();
    for (let i = 0; i < SAMPLES * SAMPLES; i++) {
      tint(verts[i * 3 + 1], baseY, normal.getY(i), c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  };

  const addCell = (key: number, cx: number, cz: number) => {
    if (loaded.current.has(key) || !groupRef.current) return;
    const mat = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(buildGeometry(cx, cz), mat);
    mesh.userData.ground = true;
    mesh.userData.terrainCell = key;
    groupRef.current.add(mesh);
    loaded.current.set(key, mesh);
    registerTerrainMesh(mesh);
  };

  const inRange = (cx: number, cz: number) =>
    !range || (cx >= range.cx0 && cx <= range.cx1 && cz >= range.cz0 && cz <= range.cz1);

  const cam = useThree((s) => s.camera);
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
    const drop: number[] = [];
    for (const key of loaded.current.keys()) {
      const cx = Math.floor(key / 65536) - 32768;
      const cz = (key % 65536) - 32768;
      if (Math.abs(cx - ccx) > VIEW_CELLS + 1 || Math.abs(cz - ccz) > VIEW_CELLS + 1) drop.push(key);
    }
    for (const key of drop) {
      const mesh = loaded.current.get(key)!;
      groupRef.current.remove(mesh);
      unregisterTerrainMesh(mesh);
      mesh.geometry.dispose();
      loaded.current.delete(key);
    }

    // Rebuild edited cells that are currently loaded (brush feedback).
    for (const key of consumeDirtyCells()) {
      const mesh = loaded.current.get(key);
      if (!mesh) continue;
      const cx = Math.floor(key / 65536) - 32768;
      const cz = (key % 65536) - 32768;
      mesh.geometry.dispose();
      mesh.geometry = buildGeometry(cx, cz);
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={basePlane} />
    </group>
  );
}
