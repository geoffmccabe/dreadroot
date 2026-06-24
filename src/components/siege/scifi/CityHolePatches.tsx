// Invisible floor colliders that plug gaps in the baked SciFi City street mesh (the player falls
// through them — notably one mid-intersection). Each patch is a flat slab registered into its own
// BVH collider group ('citypatch'), so it becomes a standable floor (and gentle wall) at that spot
// WITHOUT touching the 'citydemo' city colliders. Render-independent — no mesh is added to the scene.
//
// To plug a hole: stand on/over it, read the X / Z (and the street/deck Y) off the coords HUD, and
// add an entry below. sx/sz = the slab's metres in X/Z; centre it on the gap, slightly oversized.
import { useEffect } from 'react';
import * as THREE from 'three';
import { registerMeshGeometry, setGroupInstances, clearGroup, setMeshCollidersEnabled, type MeshInstanceInput } from '../meshColliderSystem';

interface Patch { x: number; y: number; z: number; sx: number; sz: number }
const PATCHES: Patch[] = [
  // { x: 0, y: 0.1, z: 0, sx: 8, sz: 8 },   // ← the mid-intersection hole — awaiting its exact coords
];

export function CityHolePatches() {
  useEffect(() => {
    if (!PATCHES.length) return;
    const KEY = 'citypatch_slab';
    const geo = new THREE.BoxGeometry(1, 0.4, 1);   // unit slab; instances scale it per-patch
    geo.computeBoundingBox();
    registerMeshGeometry('citypatch', KEY, geo, 1);
    const list: MeshInstanceInput[] = PATCHES.map((p) => ({
      key: KEY,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(p.sx, 1, p.sz)),
      geoBox: geo.boundingBox!.clone(),
    }));
    setGroupInstances('citypatch', list);
    setMeshCollidersEnabled(true);
    return () => clearGroup('citypatch');
  }, []);
  return null;
}
