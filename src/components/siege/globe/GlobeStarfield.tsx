// GlobeStarfield — the space backdrop for the Mini Earth map.
//
// The shared DreadRoot sky (FortressSky) cannot be used here. It is a sphere of radius 640 that
// follows the camera in X and Z but NOT Y, sized for a world a few thousand units across. On a
// map where the planet is 63,710 units in radius and viewed from 96,000 units away, that dome is
// a small object floating near the camera rather than a background, and because it draws without
// writing depth it fights the planet for the same pixels.
//
// The fix is not "make the sphere bigger". Any finite radius is wrong at some scale. The correct
// approach for a background is to detach it from depth entirely:
//   • locked to the camera on ALL THREE axes, so it can never be approached or left behind
//   • depthTest AND depthWrite off, so it neither occludes anything nor is occluded by distance
//   • renderOrder far negative, so it is painted first and everything else covers it
// With those, the radius is arbitrary and the starfield behaves as true infinity.

import { useMemo } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';

/** Arbitrary: the dome is camera-locked and never depth-tested, so this is just a shape. */
const RADIUS = 1000;

export function GlobeStarfield({ texture = '/space_night_sky.webp' }: { texture?: string }) {
  const camera = useThree((s) => s.camera);
  const tex = useLoader(THREE.TextureLoader, texture);

  const mesh = useMemo(() => {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(RADIUS, 48, 32);
    const mat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      map: tex,
      depthWrite: false,
      depthTest: false,   // the key difference from SiegeStarDome: never lose to distance
      fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -10000;
    return m;
  }, [tex]);

  // All three axes, unlike the shared sky which pins Y and would leave the dome behind the moment
  // the camera climbs out of a normal map's height range.
  useFrame(() => { mesh.position.copy(camera.position); });

  return <primitive object={mesh} />;
}
