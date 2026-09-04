// Builder Sandbox display of the imported models (mushroom trees + Khaured Tower), converted from the
// FBX/glb set in public/Mushroom Trees. Shown side by side at NATIVE height with their bottoms on
// the ground (y=0), spaced by each model's own width, centred on x=0. Every mesh is tagged
// userData.fbx so the Laser Pointer reports its name + coords. Each material is forced SOLID +
// double-sided (the FBX conversion left some with inverted normals / transparency, which made them
// look see-through and inside-out). Each mesh is also registered as a real BVH collider so the
// player collides with the actual shape. Mounted only in the Builder Sandbox (SiegeWorldLayers gates on id).
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { registerMeshGeometry, setGroupInstances, clearGroup, setMeshCollidersEnabled,
         type MeshInstanceInput } from './meshColliderSystem';
import { voxelizeGeometry } from './voxelize';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const FILES: { url: string; name: string; bump?: boolean }[] = [
  { url: '/siege/imports/mushroomtree06.glb', name: 'mushroomtree06' },
  { url: '/siege/imports/mushroomtree05.glb', name: 'mushroomtree05' },
  { url: '/siege/imports/mushroomtree07.glb', name: 'mushroomtree07' },
  { url: '/siege/imports/MushroomTree_A.glb', name: 'MushroomTree_A' },
  // Everything between MushroomTree_A and the Khaured Tower is bumped to BUMP_H tall for visibility.
  { url: '/siege/imports/Tree1.glb', name: 'Tree1', bump: true },
  { url: '/siege/imports/vasim_tree1_collider.glb', name: 'vasim_tree1_collider', bump: true },
  { url: '/siege/imports/vasim_tree1_collider_feb25.glb', name: 'vasim_tree1_collider_feb25', bump: true },
  { url: '/siege/imports/vasim_tree1_collider2.glb', name: 'vasim_tree1_collider2', bump: true },
  { url: '/siege/imports/vasim_tree1_flat.glb', name: 'vasim_tree1_flat', bump: true },
  { url: '/siege/imports/jhay_tree1.glb', name: 'jhay_tree1', bump: true },
  { url: '/siege/imports/jhay_tree2.glb', name: 'jhay_tree2', bump: true },
  { url: '/siege/imports/jhay_tree3.glb', name: 'jhay_tree3', bump: true },
  { url: '/siege/imports/jhay_tree4.glb', name: 'jhay_tree4', bump: true },
  { url: '/siege/imports/jhay_tree5.glb', name: 'jhay_tree5', bump: true },
  { url: '/siege/imports/jhay_tree6.glb', name: 'jhay_tree6', bump: true },
  // Newly-found distinct models (same-named but different content, plus the tall originals).
  { url: '/siege/imports/meshes_tree05_tall.glb', name: 'meshes_tree05_tall', bump: true },
  { url: '/siege/imports/meshes_tree06_tall.glb', name: 'meshes_tree06_tall', bump: true },
  // Ashley mushrooms are already good + correctly sized (they're used in Bleakrock) — keep native.
  { url: '/siege/imports/ashley_tree05.glb', name: 'ashley_tree05' },
  { url: '/siege/imports/mushrooms2_tree06.glb', name: 'mushrooms2_tree06' },
  { url: '/siege/imports/mushroom_line_straight.glb', name: 'mushroom_line_straight', bump: true },
  { url: '/siege/imports/Khaured_Tower_1.glb', name: 'Khaured_Tower_1' },
];
const GAP = 20;       // metres of clear space between models
const ROW_Z = -200;   // place the row in front of the Builder Sandbox spawn (0, 3, 0)
const BUMP_H = 100;   // scale the "between" models to this height so they're easy to see
const GROUP = 'mushroom-display';

// Force a material to render solid: opaque, both faces, writes depth. Fixes the see-through /
// inside-out look from inverted normals + any stray transparency the FBX export left behind.
function makeSolid(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  m.side = THREE.DoubleSide;
  m.transparent = false;
  m.depthWrite = true;
  m.alphaTest = 0;
  if ('opacity' in m) m.opacity = 1;
  m.needsUpdate = true;
}

export function MushroomImportDisplay() {
  const grpRef = useRef<THREE.Group>(null);
  const gltfs = useGLTF(FILES.map((f) => f.url), '/draco/') as unknown as { scene: THREE.Object3D }[];
  const sig = gltfs.map((g) => g.scene.uuid).join(',');

  const items = useMemo(() => {
    const box = new THREE.Box3(), size = new THREE.Vector3(), ctr = new THREE.Vector3();
    const measured = gltfs.map((g, i) => {
      const scene = g.scene.clone(true);
      scene.traverse((o) => {
        o.userData.fbx = FILES[i].name;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(makeSolid);
        }
      });
      box.setFromObject(scene); box.getSize(size); box.getCenter(ctr);
      // Bumped models: uniformly scale so their height = BUMP_H (recentered to bottom-origin in
      // Blender, so scaling about the scene origin keeps the bottom on the ground).
      const s = FILES[i].bump ? BUMP_H / (size.y || 1) : 1;
      scene.scale.setScalar(s);
      return { scene, w: (size.x || 1) * s, cx: ctr.x * s, minY: box.min.y * s };
    });
    let cursor = 0;
    const placed = measured.map((m) => {
      const center = cursor + m.w / 2;
      cursor = center + m.w / 2 + GAP;
      return { scene: m.scene, px: center - m.cx, py: -m.minY };
    });
    const shift = -(cursor - GAP) / 2;   // centre the whole row on x = 0
    return placed.map((p) => ({ ...p, px: p.px + shift }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Register every mesh as a BVH collider (real shape) so the player collides with the trees.
  useEffect(() => {
    const grp = grpRef.current; if (!grp) return;
    grp.updateWorldMatrix(true, true);
    const inputs: MeshInstanceInput[] = [];
    const boxes: THREE.Box3[] = [];
    grp.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (mesh.userData.fbx === 'Khaured_Tower_1') {
        // A building needs BOX colliders that block at the walls. A walk-on mesh collider makes the
        // ground system lift the player to the tallest surface in its footprint (the teleport bug).
        for (const b of voxelizeGeometry(geo, mesh.matrixWorld, 2.5, 4000)) boxes.push(b);
      } else {
        registerMeshGeometry((mesh.userData.fbx as string) || GROUP, geo.uuid, geo, 1);
        inputs.push({ key: geo.uuid, matrix: mesh.matrixWorld.clone(), geoBox: geo.boundingBox as THREE.Box3 });
      }
    });
    boxes.forEach((b) => worldCollisionGrid.insert(b));
    setGroupInstances(GROUP, inputs);
    setMeshCollidersEnabled(true);
    return () => { boxes.forEach((b) => worldCollisionGrid.remove(b)); clearGroup(GROUP); };
  }, [sig, items]);

  return (
    <group ref={grpRef} position={[0, 0, ROW_Z]}>
      {items.map((it, i) => <primitive key={i} object={it.scene} position={[it.px, it.py, 0]} />)}
    </group>
  );
}
