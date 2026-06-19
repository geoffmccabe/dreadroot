// TEMPORARY DIAGNOSTIC — identifies the "giant blue avatar at 0,0,0" during load.
// Scans the live scene a few times in the first seconds after mount and logs any
// mesh that is tall (>30m) or sitting near the world origin, with its name +
// parent chain so we can name the exact component rendering it. REMOVE after use.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function OriginGiantProbe() {
  const { scene } = useThree();
  useEffect(() => {
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const seen = new Set<string>();

    const chain = (o: THREE.Object3D | null): string => {
      const parts: string[] = [];
      let n: THREE.Object3D | null = o;
      let hops = 0;
      while (n && hops < 6) { parts.push(n.name || n.type); n = n.parent; hops++; }
      return parts.join(' < ');
    };

    const scan = (tag: string) => {
      scene.traverse((o) => {
        const mesh = o as any;
        if (!mesh.isMesh && !mesh.isSkinnedMesh) return;
        box.setFromObject(o);
        if (box.isEmpty()) return;
        box.getSize(size);
        box.getCenter(center);
        const tall = size.y > 30;
        const nearOrigin = Math.hypot(center.x, center.z) < 6 && Math.abs(center.y) < 600;
        if (!tall && !nearOrigin) return;
        const key = `${o.uuid}`;
        if (seen.has(key)) return;
        seen.add(key);
        // eslint-disable-next-line no-console
        console.log(
          `[OriginProbe ${tag}] name="${o.name || '(unnamed)'}" type=${o.type} ` +
          `sizeY=${size.y.toFixed(1)}m center=[${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)}] ` +
          `chain: ${chain(o.parent)}`
        );
      });
    };

    const timers = [150, 400, 800, 1500, 2500, 4000].map((ms) =>
      setTimeout(() => scan(`${ms}ms`), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [scene]);

  return null;
}
