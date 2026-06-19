// TEMPORARY DIAGNOSTIC — hunts the persistent "giant blue avatar at 0,0,0".
// Logs EVERY SkinnedMesh (the y-bot avatar is skinned) plus any tall/origin mesh,
// repeatedly for ~30s (the giant persists). Prints name, world position, world
// scale, and bounding-box size + parent chain so we can name the exact renderer.
// REMOVE after use.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function OriginGiantProbe() {
  const { scene } = useThree();
  useEffect(() => {
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const wpos = new THREE.Vector3();
    const wscale = new THREE.Vector3();
    const wquat = new THREE.Quaternion();

    const chain = (o: THREE.Object3D | null): string => {
      const parts: string[] = [];
      let n: THREE.Object3D | null = o;
      let hops = 0;
      while (n && hops < 7) { parts.push(n.name || n.type); n = n.parent; hops++; }
      return parts.join(' < ');
    };

    const scan = (tag: string) => {
      let skinned = 0;
      scene.traverse((o) => {
        const mesh = o as any;
        const isSkinned = !!mesh.isSkinnedMesh;
        const isMesh = !!mesh.isMesh;
        if (!isSkinned && !isMesh) return;
        box.setFromObject(o);
        if (box.isEmpty()) return;
        box.getSize(size);
        box.getCenter(center);
        o.getWorldPosition(wpos);
        o.matrixWorld.decompose(wpos, wquat, wscale);
        const tall = size.y > 15;
        const nearOrigin = Math.hypot(center.x, center.z) < 8;
        // Always log skinned meshes (avatars/characters); log plain meshes only if tall or at origin.
        if (!isSkinned && !tall && !nearOrigin) return;
        if (isSkinned) skinned++;
        // eslint-disable-next-line no-console
        console.log(
          `[OriginProbe ${tag}] ${isSkinned ? 'SKINNED' : 'mesh'} name="${o.name || '(unnamed)'}" ` +
          `sizeY=${size.y.toFixed(1)}m center=[${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)}] ` +
          `worldScale=[${wscale.x.toFixed(3)},${wscale.y.toFixed(3)},${wscale.z.toFixed(3)}] ` +
          `chain: ${chain(o.parent)}`
        );
      });
      // eslint-disable-next-line no-console
      console.log(`[OriginProbe ${tag}] total skinned meshes in scene = ${skinned}`);
    };

    const timers = [800, 2500, 5000, 9000, 15000, 25000].map((ms) =>
      setTimeout(() => scan(`${(ms / 1000).toFixed(0)}s`), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [scene]);

  return null;
}
