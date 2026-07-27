// KaijuLabController — mounts the Kaiju on the Mini Earth and owns its keys.
//
// Steps D1-D3 of docs/MINI_EARTH_P1_BUILD.md.
//
//   [  ]   cycle through the four Kaiju candidates
//   -  =   scale the current one down/up in 5% steps
//   0      reset to the default size
//   K      land: drop to just above the ground where you are
//   B or ; battle: drop in at Mount Everest, where three other Kaiju are waiting
//   '      200 people, 1.8 m tall, around the Kaiju — for a sense of its scale
//   R      roar — for testing speed-of-sound delay (1 km = 2.9 s late)
//          (also starts on its own when you arrive at Everest with , or .)
//   , .    previous / next of the 226 real landmarks, flying you straight there
//
// Keys must be checked against the WHOLE codebase, not assumed free. Every letter key is
// already bound somewhere — B in particular is the SciFi Space teleport in siegeAreas, which
// silently stole the battle key and made the whole feature look broken.

import { useEffect, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { latLonToDirection } from './cubeSphere';
import { loadLandmarks, stepLandmark, currentLandmark } from './landmarkJump';
import { enterWalkMode, dropKaijuAt } from './KaijuWalkController';
import {
  cycleKaiju, scaleKaiju, resetKaijuSize, getKaijuLab, subscribeKaijuLab, setKaijuHeight,
} from './kaijuLabState';
import { GlobeKaiju } from './GlobeKaiju';
import { KaijuArenaScene } from './KaijuArenaScene';
import { KaijuCrowd, toggleCrowd } from './KaijuCrowd';
import { roar } from './kaijuAudio';
import { body as playerBody } from './kaijuBody';
import { initArena, ARENA_HEIGHT, arenaStarted } from './kaijuArena';

// The Kaiju is no longer parked at a fixed place: it follows the camera in third person, so it
// is always in front of you (see GlobeKaiju). K now means "drop to the ground here", which is
// what you actually want while flying around.


/**
 * Drop in at Mount Everest with three other Kaiju already there and let the fight begin.
 *
 * Shared by the Semicolon key and by simply ARRIVING at Everest on the landmark tour, so the
 * feature does not hinge on one keypress surviving a codebase where every letter is already bound.
 */
function startArenaHere(camera: THREE.Camera): void {
  setKaijuHeight(ARENA_HEIGHT);
  const dir = initArena(17);
  const face = new THREE.Vector3(0, 1, 0).cross(dir);
  if (face.lengthSq() < 1e-6) face.set(1, 0, 0);
  face.normalize();
  // Drop from one body height: unmistakably a fall, without a long wait before you can move.
  dropKaijuAt(dir, face, 1);
  const surface = dir.clone().multiplyScalar(
    PLANET_RADIUS + (sampleGlobeSurface(dir.x, dir.y, dir.z) ?? 0) / METRES_PER_UNIT,
  );
  camera.position.copy(surface)
    .addScaledVector(dir, ARENA_HEIGHT * 2.2)
    .addScaledVector(face, -ARENA_HEIGHT * 4.2);
  camera.lookAt(surface.clone().addScaledVector(dir, ARENA_HEIGHT * 0.55));
  console.log('[kaiju] battle started at Mount Everest — 4 Kaiju');
}

export function KaijuLabController() {
  const state = useSyncExternalStore(subscribeKaijuLab, getKaijuLab, getKaijuLab);
  const camera = useThree((s) => s.camera);

  useEffect(() => { void loadLandmarks(); }, []);

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
        case 'Comma':
        case 'Period': {
          // Jump to a real landmark. The spawn is over Houston, which is flat coastal plain, so
          // judging the terrain from there judges ground that genuinely has no relief.
          const lm = stepLandmark(e.code === 'Period' ? 1 : -1);
          if (!lm) break;
          const dir = new Float64Array(3);
          latLonToDirection(lm.lat, lm.lon, dir);
          const up = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
          const groundMetres = sampleGlobeSurface(up.x, up.y, up.z) ?? 0;
          const h = getKaijuLab().height;
          // Stand off by a few kilometres so the whole formation is in frame, then look down at it.
          const surface = up.clone().multiplyScalar(
            PLANET_RADIUS + groundMetres / METRES_PER_UNIT,
          );
          const side = new THREE.Vector3(0, 1, 0).cross(up);
          if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
          side.normalize();
          // Drop the Kaiju in AT the landmark and hand over control, rather than parking the
          // camera above it in fly mode. Flying is what made the Kaiju appear to slide across the
          // ground when the mouse moved and never fall: in fly mode it is carried by the camera
          // with no gravity, by design. Arriving somewhere should mean standing there.
          const face = side.clone();                       // any tangent will do as an initial facing
          // ONE body height, not three. Gravity is real 9.81 m/s^2, so at this scale a 3-body
          // drop (900 m) falls for 13.5 seconds; one body height is 300 m and 7.8 seconds, which
          // still reads unmistakably as falling without a long wait before you can move.
          dropKaijuAt(up, face, 1);
          // Put the camera roughly where the chase camera will settle, so the handover does not
          // start with a long lerp across the sky.
          camera.position.copy(surface)
            .addScaledVector(up, h * 2.2)
            .addScaledVector(face, -h * 4.2);
          camera.lookAt(surface.clone().addScaledVector(up, h * 0.55));
          console.log(`[earth] -> ${lm.n} (${lm.lat}, ${lm.lon}) — dropping in`);
          // ARRIVING AT EVEREST STARTS THE FIGHT.
          //
          // This is what was asked for in the first place: drop in at Everest and the other Kaiju
          // are waiting. Making it depend on a separate keypress meant that when that key turned
          // out to be taken, the whole feature was invisible. Arriving at the place is the natural
          // trigger and cannot be swallowed by another binding.
          if (lm.n === 'Mount Everest' && !arenaStarted()) startArenaHere(camera);
          break;
        }
        // B *AND* SEMICOLON, and it also starts on arrival at Everest.
        //
        // I moved this off B after finding B bound in siegeAreas as the SciFi Space teleport, and
        // assumed that was why the opponents never appeared. That was WRONG: B demonstrably worked
        // on this map — the real cause was a missing re-render, fixed separately — and moving it
        // broke a key Geoff was already using. Restored, with the alias and the automatic start
        // kept as well, since three ways in is strictly better than one.
        case 'KeyB':
        case 'Semicolon': {
          startArenaHere(camera);
          break;
        }
        // APOSTROPHE — the crowd. Verified unbound across the whole codebase before choosing it,
        // which is the lesson from B silently being the SciFi Space teleport.
        case 'Quote':
          toggleCrowd();
          break;
        // R — ROAR. For testing the acoustics: fire it, then walk away and fire it again. At 1 km
        // the sound arrives 2.9 s after the keypress, at 2 km nearly 6 s. That gap IS the feature.
        case 'KeyR': {
          const at = playerBody.dir.clone().multiplyScalar(playerBody.radius + 2);
          const look = new THREE.Vector3();
          camera.getWorldDirection(look);
          roar(at, camera.position, look);
          break;
        }
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
          // ...and HAND OVER THE CHARACTER. Landing while still in fly mode is what made the
          // Kaiju feel broken: in fly mode it is carried by the camera with no gravity and no
          // ground contact by design, so moving the mouse slid it through the air. "Land" should
          // mean you are now standing on the planet, which is walk mode.
          enterWalkMode(camera);
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

  return (
    <>
      <GlobeKaiju state={state} />
      {/* The arena drives itself once a battle has started; before that it draws nothing. */}
      <KaijuArenaScene playerControlled />
      {/* 200 humans for scale, toggled with the apostrophe key. */}
      <KaijuCrowd />
    </>
  );
}
