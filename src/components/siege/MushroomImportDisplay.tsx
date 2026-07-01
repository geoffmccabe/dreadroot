// Starblink display of the imported models (mushroom trees + Khaured Tower), converted from the
// FBX/glb set in public/Mushroom Trees. Shown side by side at NATIVE height with their bottoms on
// the ground (y=0), spaced by each model's own width, centred on x=0. Every mesh is tagged
// userData.fbx so the Laser Pointer reports its name + coords for copy/paste. Mounted only in
// Starblink (SiegeWorldLayers gates on world.id). Preview-only: static props, no colliders.
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const FILES = [
  { url: '/siege/imports/mushroomtree06.glb', name: 'mushroomtree06' },              // ~49 m
  { url: '/siege/imports/mushroomtree05.glb', name: 'mushroomtree05' },              // ~55 m
  { url: '/siege/imports/mushroomtree07.glb', name: 'mushroomtree07' },              // ~42 m
  { url: '/siege/imports/MushroomTree_A.glb', name: 'MushroomTree_A' },              // ~19 m
  { url: '/siege/imports/Tree1.glb', name: 'Tree1' },                                // ~6 m
  { url: '/siege/imports/vasim_tree1_collider.glb', name: 'vasim_tree1_collider' },
  { url: '/siege/imports/vasim_tree1_collider_feb25.glb', name: 'vasim_tree1_collider_feb25' },
  { url: '/siege/imports/vasim_tree1_collider2.glb', name: 'vasim_tree1_collider2' },
  { url: '/siege/imports/vasim_tree1_flat.glb', name: 'vasim_tree1_flat' },
  { url: '/siege/imports/jhay_tree1.glb', name: 'jhay_tree1' },
  { url: '/siege/imports/jhay_tree2.glb', name: 'jhay_tree2' },
  { url: '/siege/imports/jhay_tree3.glb', name: 'jhay_tree3' },
  { url: '/siege/imports/jhay_tree4.glb', name: 'jhay_tree4' },
  { url: '/siege/imports/jhay_tree5.glb', name: 'jhay_tree5' },
  { url: '/siege/imports/jhay_tree6.glb', name: 'jhay_tree6' },
  { url: '/siege/imports/Khaured_Tower_1.glb', name: 'Khaured_Tower_1' },
];
const GAP = 20;       // metres of clear space between models
const ROW_Z = -200;   // place the row in front of the Starblink spawn (0, 3, 0)

export function MushroomImportDisplay() {
  const gltfs = useGLTF(FILES.map((f) => f.url), '/draco/') as unknown as { scene: THREE.Object3D }[];
  const sig = gltfs.map((g) => g.scene.uuid).join(',');
  const items = useMemo(() => {
    const box = new THREE.Box3(), size = new THREE.Vector3(), ctr = new THREE.Vector3();
    const measured = gltfs.map((g, i) => {
      const scene = g.scene.clone(true);
      scene.traverse((o) => { o.userData.fbx = FILES[i].name; });
      box.setFromObject(scene); box.getSize(size); box.getCenter(ctr);
      return { scene, w: size.x || 1, cx: ctr.x, minY: box.min.y };
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

  return (
    <group position={[0, 0, ROW_Z]}>
      {items.map((it, i) => <primitive key={i} object={it.scene} position={[it.px, it.py, 0]} />)}
    </group>
  );
}
