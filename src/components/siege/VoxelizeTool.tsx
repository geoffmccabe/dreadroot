// VoxelizeTool — point the laser (L) at a rock/object and press V to toggle its collider
// between a single oversized box (default) and a 1m voxel SHELL of the real mesh:
//   • first V  → voxelize that one object (removes its box, inserts the shell),
//   • V again  → revert it to the box.
// The edit is PERMANENT (the instance becomes "managed" — WorldObjectsLayer stops owning its
// collider, so it survives flying away and back) and REVERSIBLE. Each rock instance is keyed by
// type+position, so pointing anywhere on it toggles that whole group. Siege-only.
import { useEffect } from 'react';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { voxelizeGeometry } from './voxelize';
import { managedRocks, keyFor } from './voxelOverrides';
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

export function VoxelizeTool() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      const fbx = (mesh.userData as { fbx?: string })?.fbx || mesh.name || mesh.uuid;
      const key = keyFor(fbx, _world.elements[12], _world.elements[14]);
      const removeAll = (boxes: THREE.Box3[]) => boxes.forEach((b) => worldCollisionGrid.remove(b));

      const existing = managedRocks.get(key);
      if (existing) {
        // Toggle the already-managed instance.
        if (existing.voxel) {
          removeAll(existing.boxes);
          const box = bigBox(geo, _world);
          worldCollisionGrid.insert(box);
          managedRocks.set(key, { boxes: [box], voxel: false });
        } else {
          const vox = voxelizeGeometry(geo, _world, 1.0, 4000);
          if (!vox.length) { console.warn('[VoxelizeTool] mesh too large to voxelize — kept as box'); return; }
          removeAll(existing.boxes);
          vox.forEach((b) => worldCollisionGrid.insert(b));
          managedRocks.set(key, { boxes: vox, voxel: true });
        }
      } else {
        // First touch: voxelize. Remove WorldObjectsLayer's oversized box for this instance.
        const vox = voxelizeGeometry(geo, _world, 1.0, 4000);
        if (!vox.length) { console.warn('[VoxelizeTool] mesh too large to voxelize — left as box'); return; }
        if (!geo.boundingBox) geo.computeBoundingBox();
        _bb.copy(geo.boundingBox!).applyMatrix4(_world);
        const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
        if (cells) {
          const kill: THREE.Box3[] = [];
          for (const bx of cells.keys()) {
            bx.getSize(_sz);
            if (_sz.x < 1.5 && _sz.z < 1.5) continue;     // leave existing small voxels alone
            bx.getCenter(_ctr);
            if (_bb.containsPoint(_ctr)) kill.push(bx);
          }
          kill.forEach((bx) => worldCollisionGrid.remove(bx));
        }
        vox.forEach((b) => worldCollisionGrid.insert(b));
        managedRocks.set(key, { boxes: vox, voxel: true });
      }
      window.dispatchEvent(new Event('sw-colliders-changed'));
      const now = managedRocks.get(key)!;
      console.log(`[VoxelizeTool] ${key} → ${now.voxel ? now.boxes.length + ' voxels' : 'box'}`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return null;
}
