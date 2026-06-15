// VoxelizeTool — point the laser (L) at a rock/object and press V to voxelize THAT mesh into
// 1m cubes on the spot: it removes the object's oversized AABB collider and inserts a 1m voxel
// shell of the real mesh, so you see the result instantly in the collider debug view. Lets you
// fix problem colliders one at a time and tune the rules. Siege-only.
import { useEffect } from 'react';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { voxelizeGeometry } from './voxelize';
import { probeState } from './probeState';

const _inst = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _bb = new THREE.Box3();
const _ctr = new THREE.Vector3();
const _sz = new THREE.Vector3();

export function VoxelizeTool() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV' || !probeState.on || !probeState.mesh) return;
      e.preventDefault(); e.stopPropagation();
      const mesh = probeState.mesh as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo?.attributes?.position) return;

      // World matrix of the pointed thing (one instance of an InstancedMesh, or a plain mesh).
      const im = mesh as unknown as THREE.InstancedMesh;
      if (im.isInstancedMesh && probeState.instanceId >= 0) {
        im.getMatrixAt(probeState.instanceId, _inst);
        _world.multiplyMatrices(mesh.matrixWorld, _inst);
      } else {
        _world.copy(mesh.matrixWorld);
      }

      // Remove this object's oversized AABB collider(s) — keep any existing 1m voxels.
      if (!geo.boundingBox) geo.computeBoundingBox();
      _bb.copy(geo.boundingBox!).applyMatrix4(_world);
      const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
      let removed = 0;
      if (cells) {
        const kill: THREE.Box3[] = [];
        for (const bx of cells.keys()) {
          bx.getSize(_sz);
          if (_sz.x < 1.5 && _sz.z < 1.5 && _sz.y < 1.5) continue;   // leave existing 1m voxels alone
          bx.getCenter(_ctr);
          if (_bb.containsPoint(_ctr)) kill.push(bx);
        }
        kill.forEach((bx) => { worldCollisionGrid.remove(bx); removed++; });
      }

      // Voxelize the MESH (not the box) into 1m cubes and insert them.
      const boxes = voxelizeGeometry(geo, _world, 1.0, 4000);
      boxes.forEach((bx) => worldCollisionGrid.insert(bx));
      // Tell the debug view to rebuild so the new voxels appear immediately.
      window.dispatchEvent(new Event('sw-colliders-changed'));
      console.log(`[VoxelizeTool] ${probeState.hit}: removed ${removed} oversized collider(s) → ${boxes.length} 1m cells`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return null;
}
