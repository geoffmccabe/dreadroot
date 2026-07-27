// KaijuLabController — mounts the Kaiju on the Mini Earth and owns its keys.
//
// Steps D1-D3 of docs/MINI_EARTH_P1_BUILD.md.
//
//   [  ]   cycle through the four Kaiju candidates
//   -  =   scale the current one down/up in 5% steps
//   0      reset to the default size
//   K      land: drop to just above the ground where you are
//
// Keys are chosen because they are unused elsewhere, and this component only mounts on the
// globe map, so it cannot interfere with play keys on any other map.

import { useEffect, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import {
  cycleKaiju, scaleKaiju, resetKaijuSize, getKaijuLab, subscribeKaijuLab,
} from './kaijuLabState';
import { GlobeKaiju } from './GlobeKaiju';

// The Kaiju is no longer parked at a fixed place: it follows the camera in third person, so it
// is always in front of you (see GlobeKaiju). K now means "drop to the ground here", which is
// what you actually want while flying around.


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
          // Land here: drop straight down to just above the ground at the current position.
          // Descending by hand from orbit takes over a minute, and stopping at the right height
          // by eye is fiddly, so this is the shortcut to actually standing on the planet.
          const up = camera.position.clone();
          if (up.lengthSq() < 1e-6) break;
          up.normalize();
          const groundMetres = sampleGlobeSurface(up.x, up.y, up.z) ?? 0;
          const h = getKaijuLab().height;
          // Sit a couple of Kaiju heights up, so it is in frame below and ahead of the camera.
          camera.position.copy(up).multiplyScalar(
            PLANET_RADIUS + groundMetres / METRES_PER_UNIT + h * 2.0,
          );
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

  return <GlobeKaiju state={state} />;
}
