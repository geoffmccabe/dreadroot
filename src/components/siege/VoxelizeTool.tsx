// VoxelizeTool — point the laser (L) at a rock/object, then:
//   V        → toggle its collider between a single oversized box (default) and a greedy-merged
//              set of boxes approximating the mesh,
//   < / >    → re-approximate the LAST voxelized object at a coarser / finer resolution (fewer /
//              more boxes), to dial in the fit,
// A small readout shows the object name + box (primitive) count + cell size. Edits are PERMANENT
// (the instance becomes "managed" so WorldObjectsLayer stops owning its collider — survives
// streaming reloads) and reversible (V again → back to the single box). Siege-only.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { voxelizeGeometry } from './voxelize';
import { managedRocks, keyFor, setColliderOverride, colliderOverrides, exportColliderOverrides, saveColliderOverrideToDB } from './voxelOverrides';
import { setModelDecimation, meshModelTriCount, meshModelInstanceCount } from './meshColliderSystem';
import { probeState } from './probeState';

const _inst = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _bb = new THREE.Box3();
const _ctr = new THREE.Vector3();
const _sz = new THREE.Vector3();

function bigBox(geo: THREE.BufferGeometry, world: THREE.Matrix4): THREE.Box3 {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const wb = geo.boundingBox!.clone().applyMatrix4(world);
  const ctr = wb.getCenter(new THREE.Vector3());
  const half = wb.getSize(new THREE.Vector3()).multiplyScalar(0.8 * 0.5);
  wb.min.copy(ctr).sub(half); wb.max.copy(ctr).add(half);
  return wb;
}

// Remove WorldObjectsLayer's oversized box(es) for an instance (big colliders centred in its AABB).
function removeBigBoxOverlapping(geo: THREE.BufferGeometry, world: THREE.Matrix4) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  _bb.copy(geo.boundingBox!).applyMatrix4(world);
  const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
  if (!cells) return;
  const kill: THREE.Box3[] = [];
  for (const bx of cells.keys()) {
    bx.getSize(_sz);
    if (_sz.x < 1.5 && _sz.z < 1.5) continue;  // leave small/voxel boxes alone
    bx.getCenter(_ctr);
    if (_bb.containsPoint(_ctr)) kill.push(bx);
  }
  kill.forEach((bx) => worldCollisionGrid.remove(bx));
}

function info(text: string) {
  let el = document.getElementById('sw-voxel-info');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sw-voxel-info';
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;font:12px monospace;color:#39ff14;background:rgba(0,0,0,.6);padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

export function VoxelizeTool() {
  // Last voxelized instance, so < / > can re-approximate it at a new resolution.
  const last = useRef<{ key: string; geo: THREE.BufferGeometry; world: THREE.Matrix4; cell: number } | null>(null);

  useEffect(() => {
    // Returns the new box count, or -1 if the mesh is too large to voxelize at this resolution.
    const voxelizeInstance = (key: string, geo: THREE.BufferGeometry, world: THREE.Matrix4, cell: number): number => {
      const vox = voxelizeGeometry(geo, world, cell, 2000);
      if (!vox.length) return -1;                          // too big at this cell → leave as-is
      const ex = managedRocks.get(key);
      if (ex) ex.boxes.forEach((b) => worldCollisionGrid.remove(b));
      else removeBigBoxOverlapping(geo, world);
      vox.forEach((b) => worldCollisionGrid.insert(b));
      managedRocks.set(key, { boxes: vox, voxel: true });
      setColliderOverride(key, true, cell);   // persist (localStorage) so it survives reload
      void saveColliderOverrideToDB(key, true, cell); // + Supabase (shared, all players)
      window.dispatchEvent(new Event('sw-colliders-changed'));
      return vox.length;
    };

    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+B — copy ALL saved collider overrides to the clipboard, to bake into the
      // shipped map (paste to the dev → committed to /siege/world/collider_overrides.json).
      if (e.code === 'KeyB' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        navigator.clipboard?.writeText(exportColliderOverrides()).catch(() => {});
        info(`copied ${colliderOverrides.size} collider override(s) to clipboard`);
        return;
      }
      // < / > — coarser / finer.
      if (e.key === '<' || e.key === ',' || e.key === '>' || e.key === '.') {
        const coarser = e.key === '<' || e.key === ',';
        // If the laser is on a MESH-flagged model, tune its DECIMATION live
        // (fewer / more polygons). Re-decimates the BVH for all its instances.
        const pf = (probeState.on && probeState.mesh)
          ? ((probeState.mesh as THREE.Mesh).userData as { fbx?: string })?.fbx : undefined;
        const mov = pf ? colliderOverrides.get(pf) : undefined;
        if (pf && mov?.mesh) {
          e.preventDefault(); e.stopPropagation();
          try {
            const ratio = THREE.MathUtils.clamp((mov.cell || 1) * (coarser ? 0.6 : 1 / 0.6), 0.01, 1);
            setColliderOverride(pf, false, ratio, true);
            void saveColliderOverrideToDB(pf, false, ratio, true);
            const tris = setModelDecimation(pf, ratio);
            window.dispatchEvent(new Event('sw-colliders-changed'));
            info(tris > 0
              ? `${pf}\nMESH COLLIDER — ${tris} polys @ ${Math.round(ratio * 100)}%\n<  simpler   /   >  finer`
              : `${pf}\nmesh ${Math.round(ratio * 100)}% saved — reload to apply, then tune`);
          } catch (err) {
            info(`${pf}\ndecimate failed: ${(err as Error)?.message ?? err}`);
          }
          return;
        }
        // Otherwise re-approximate the last VOXELIZED object coarser / finer.
        const L = last.current; if (!L) return;
        e.preventDefault(); e.stopPropagation();
        const cell = THREE.MathUtils.clamp(L.cell * (coarser ? 1.3 : 1 / 1.3), 0.3, 6);
        const n = voxelizeInstance(L.key, L.geo, L.world, cell);
        if (n < 0) { info('mesh too large — press < for coarser'); return; }
        L.cell = cell;
        info(`${L.key.split('@')[0]}\n${n} boxes @ ${cell.toFixed(2)}m  (< coarser / > finer)`);
        return;
      }
      // M — toggle a TRUE MESH collider (three-mesh-bvh) for the pointed MODEL.
      // Per-model (all copies of that rock/mountain), saved to Supabase, applied
      // on world (re)build/reload. Requires the world's meshColliders flag.
      if (e.code === 'KeyM' && probeState.on && probeState.mesh) {
        e.preventDefault(); e.stopPropagation();
        const fbx = ((probeState.mesh as THREE.Mesh).userData as { fbx?: string })?.fbx;
        if (!fbx) { info('aim at a world object (rock / mountain)'); return; }
        const on = !colliderOverrides.get(fbx)?.mesh;
        setColliderOverride(fbx, false, 1, on);          // model-level key = fbx
        void saveColliderOverrideToDB(fbx, false, 1, on);
        window.dispatchEvent(new Event('sw-colliders-changed'));
        info(`${fbx}\nmesh collider ${on ? 'ON — all copies (reload to apply)' : 'OFF'} (saved)`);
        return;
      }

      if (e.code !== 'KeyV' || !probeState.on || !probeState.mesh) return;
      e.preventDefault(); e.stopPropagation();
      const mesh = probeState.mesh as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo?.attributes?.position) return;
      const im = mesh as unknown as THREE.InstancedMesh;
      if (im.isInstancedMesh && probeState.instanceId >= 0) {
        im.getMatrixAt(probeState.instanceId, _inst);
        _world.multiplyMatrices(mesh.matrixWorld, _inst);
      } else {
        _world.copy(mesh.matrixWorld);
      }
      const fbx = (mesh.userData as { fbx?: string })?.fbx;
      if (!fbx) { info('aim at a world object (rock / building)'); return; }   // not terrain / monsters
      const key = keyFor(fbx, _world.elements[12], _world.elements[14]);

      const ex = managedRocks.get(key);
      if (ex && ex.voxel) {
        // Revert to a single box.
        ex.boxes.forEach((b) => worldCollisionGrid.remove(b));
        const box = bigBox(geo, _world);
        worldCollisionGrid.insert(box);
        managedRocks.set(key, { boxes: [box], voxel: false });
        setColliderOverride(key, false, 1);   // persist the revert too
        void saveColliderOverrideToDB(key, false, 1); // + Supabase
        window.dispatchEvent(new Event('sw-colliders-changed'));
        last.current = null;
        info(`${fbx}\nreverted to 1 box (saved)`);
      } else {
        // Voxelize (greedy-merged) at 1m to start.
        const cell = 1.0;
        const n = voxelizeInstance(key, geo, _world, cell);
        if (n < 0) { info(`${fbx}\nmesh too large to voxelize at 1m — press < after`); return; }
        last.current = { key, geo, world: _world.clone(), cell };
        info(`${fbx}\n${n} boxes @ ${cell.toFixed(2)}m  (< coarser / > finer)`);
      }
    };
    window.addEventListener('keydown', onKey, true);

    // Persistent menu: while the laser is on a MESH-flagged model, show its live
    // polygon count + the < / > hint in the bottom-left readout.
    const poll = window.setInterval(() => {
      if (!probeState.on || !probeState.mesh) return;
      const fbx = ((probeState.mesh as THREE.Mesh).userData as { fbx?: string })?.fbx;
      if (!fbx) return;
      const ov = colliderOverrides.get(fbx);
      if (ov?.mesh) {
        const tris = meshModelTriCount(fbx);
        const inst = meshModelInstanceCount(fbx);
        info(inst > 0
          ? `${fbx}\nMESH COLLIDER — ${tris} polys @ ${Math.round((ov.cell || 1) * 100)}% — ${inst} copies\n<  simpler   /   >  finer`
          : `${fbx}\nMESH COLLIDER (reload to apply)\n<  simpler   /   >  finer`);
      }
    }, 300);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearInterval(poll);
      document.getElementById('sw-voxel-info')?.remove();
      // The collision grid is SHARED with Dreadroot — drop our voxel edits when leaving Siege
      // Worlds so they don't become phantom colliders in the other game.
      managedRocks.forEach((e) => e.boxes.forEach((b) => worldCollisionGrid.remove(b)));
      managedRocks.clear();
    };
  }, []);
  return null;
}
