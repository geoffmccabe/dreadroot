// KaijuLabController — mounts the Kaiju on the Mini Earth and owns its keys.
//
// Steps D1-D3 of docs/MINI_EARTH_P1_BUILD.md.
//
//   [  ]   cycle through the four Kaiju candidates
//   -  =   scale the current one down/up in 5% steps
//   0      reset to the default size
//   K      snap the camera to just above the Kaiju (it is a speck on a 63,710-unit planet,
//          so without this it is genuinely hard to find)
//
// Keys are chosen because they are unused elsewhere, and this component only mounts on the
// globe map, so it cannot interfere with play keys on any other map.

import { useEffect, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { sampleGlobeElevation } from './globeGround';
import {
  cycleKaiju, scaleKaiju, resetKaijuSize, getKaijuLab, subscribeKaijuLab,
} from './kaijuLabState';
import { KaijuDisplay } from './KaijuDisplay';

/**
 * Where the Kaiju stands. Chosen to be somewhere unmistakable from orbit and clearly on land:
 * the Himalaya, so the surrounding terrain is dramatic at any scale.
 */
export const KAIJU_LAT = 28.0;
export const KAIJU_LON = 86.9;

export function KaijuLabController() {
  const state = useSyncExternalStore(subscribeKaijuLab, getKaijuLab, getKaijuLab);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.code) {
        case 'BracketLeft':  cycleKaiju(-1); break;
        case 'BracketRight': cycleKaiju(1); break;
        case 'Minus':        scaleKaiju(-1); break;
        case 'Equal':        scaleKaiju(1); break;
        case 'Digit0':       resetKaijuSize(); break;
        case 'KeyK': {
          // Put the camera a few Kaiju-heights back and up, looking at it.
          const dir = new Float64Array(3);
          latLonToDirection(KAIJU_LAT, KAIJU_LON, dir);
          const up = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
          const groundMetres = sampleGlobeElevation(up.x, up.y, up.z) ?? 0;
          const surface = up.clone().multiplyScalar(PLANET_RADIUS + groundMetres / METRES_PER_UNIT);
          const h = getKaijuLab().height;
          // Offset along any direction perpendicular to up, so we look at it side-on.
          const side = new THREE.Vector3(0, 1, 0).cross(up);
          if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
          side.normalize();
          camera.position.copy(surface)
            .addScaledVector(up, h * 0.9)
            .addScaledVector(side, h * 2.2);
          camera.lookAt(surface.clone().addScaledVector(up, h * 0.5));
          break;
        }
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [camera]);

  return <KaijuDisplay state={state} lat={KAIJU_LAT} lon={KAIJU_LON} />;
}
