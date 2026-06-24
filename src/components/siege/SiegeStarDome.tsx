// SiegeStarDome — the DreadRoot night-sky starfield (the same /space_night_sky.webp projected on an
// inverted sphere) for night siege maps (SciFi City). Self-contained: an additive BackSide sphere
// that follows the camera and renders behind everything (no day/night cycle — always full night).
import { useMemo } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';

export function SiegeStarDome({ texture = '/space_night_sky.webp', radius = 638 }: { texture?: string; radius?: number }) {
  const camera = useThree((s) => s.camera);
  const tex = useLoader(THREE.TextureLoader, texture);
  const mesh = useMemo(() => {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(radius, 64, 32);
    const mat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide, map: tex, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = -1000;   // draw first, behind all city geometry
    return m;
  }, [tex, radius]);
  // Park the dome on the camera each frame so the player stays at its centre.
  useFrame(() => { mesh.position.set(camera.position.x, -50, camera.position.z); });
  return <primitive object={mesh} />;
}
