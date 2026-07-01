// Starblink display of the four imported mushroom-tree FBX models (converted to glb via Blender).
// Shown side by side at NATIVE height with their bottoms on the ground (y=0), spaced by each model's
// own width. Each mesh is tagged userData.fbx so the Laser Pointer reports its name + coords for
// copy/paste. Mounted only in Starblink (SiegeWorldLayers gates on world.id). Preview-only: static
// props, no colliders.
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const FILES = [
  { url: '/siege/imports/mushroomtree06.glb', name: 'mushroomtree06' },   // ~118 m
  { url: '/siege/imports/mushroomtree05.glb', name: 'mushroomtree05' },   // ~66 m
  { url: '/siege/imports/MushroomTree_A.glb', name: 'MushroomTree_A' },   // ~19 m
  { url: '/siege/imports/mushroomtree07.glb', name: 'mushroomtree07' },   // ~42 m
];
const GAP = 25;       // metres of clear space between models
const ROW_Z = -160;   // place the row in front of the Starblink spawn (0, 3, 0)

export function MushroomImportDisplay() {
  const gltfs = [
    useGLTF(FILES[0].url, '/draco/'),
    useGLTF(FILES[1].url, '/draco/'),
    useGLTF(FILES[2].url, '/draco/'),
    useGLTF(FILES[3].url, '/draco/'),
  ];
  const items = useMemo(() => {
    const box = new THREE.Box3(), size = new THREE.Vector3(), ctr = new THREE.Vector3();
    const measured = gltfs.map((g, i) => {
      const scene = g.scene.clone(true);
      scene.traverse((o) => { o.userData.fbx = FILES[i].name; });
      box.setFromObject(scene); box.getSize(size); box.getCenter(ctr);
      return { scene, w: size.x, cx: ctr.x, minY: box.min.y };
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
  }, [gltfs[0].scene, gltfs[1].scene, gltfs[2].scene, gltfs[3].scene]);

  return (
    <group position={[0, 0, ROW_Z]}>
      {items.map((it, i) => <primitive key={i} object={it.scene} position={[it.px, it.py, 0]} />)}
    </group>
  );
}
