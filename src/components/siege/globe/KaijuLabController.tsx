// KaijuLabController — mounts the Kaiju on the Mini Earth and owns its keys.
//
// Steps D1-D3 of docs/MINI_EARTH_P1_BUILD.md.
//
//   [  ]   cycle through the four Kaiju candidates
//   -  =   scale the current one down/up in 5% steps
//   0      reset to the default size
//   K      land: drop to just above the ground where you are
//   B or ; battle: drop in at Mount Everest, where three other Kaiju are waiting
//   1-9    stage the battle somewhere else
//          2 = Grand Canyon SCALE SHOT: eye at 1.8 m, Kaiju 500 m off, 200 people between
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
import { enterWalkMode, dropKaijuAt, setChaseShot, resetChaseShot } from './KaijuWalkController';
import {
  cycleKaiju, scaleKaiju, resetKaijuSize, getKaijuLab, subscribeKaijuLab, setKaijuHeight,
} from './kaijuLabState';
import { GlobeKaiju } from './GlobeKaiju';
import { KaijuArenaScene } from './KaijuArenaScene';
import { KaijuGunfireFx } from './KaijuGunfireFx';
import { KaijuShoutsFx } from './KaijuShoutsFx';
import { KaijuColliderDebug, toggleColliderDebug } from './KaijuColliderDebug';
import { KaijuCity } from './KaijuCity';
import { GlobeErrorBoundary } from './GlobeErrorBoundary';
import { KaijuCrowd, toggleCrowd, setCrowd, setCrowdCorridor } from './KaijuCrowd';
import { roar } from './kaijuAudio';
import { body as playerBody } from './kaijuBody';
import { initArena, ARENA_HEIGHT, arenaStarted } from './kaijuArena';

// The Kaiju is no longer parked at a fixed place: it follows the camera in third person, so it
// is always in front of you (see GlobeKaiju). K now means "drop to the ground here", which is
// what you actually want while flying around.


/**
 * Where a battle can be staged. Number keys pick one; each drops you in with the other Kaiju.
 *
 * Geoff: "make it so if I hit 2 after B then it goes to the grand canyon. Same thing with other
 * Kaijus that attack." So these are full battles, not sightseeing jumps.
 */
export const ARENA_SITES: {
  key: string; name: string; lat: number; lon: number;
  /** Compass bearing to face on arrival, degrees, 0 = north. Omit for "any tangent will do". */
  facingDeg?: number;
}[] = [
  { key: 'Digit1', name: 'Mount Everest',   lat: 27.9881, lon: 86.9250 },
  // MATHER POINT, the South Rim visitor centre — not a coordinate picked off a map.
  //
  // Geoff: "I land on a relatively flat and featureless area... there appears to be a canyon, but
  // it's only around 300-500 m deep."
  //
  // scripts/probe-canyon-sites measured the real elevation data at nine named viewpoints and found
  // the old drop (36.1069, -112.1129) stands at 1020 m — that is the canyon FLOOR, about 1,100 m
  // BELOW the rim. Standing on the floor of a canyon is the one place a canyon cannot read as one.
  // Every rim viewpoint measures 2100-2600 m.
  //
  // scripts/probe-canyon-rim then searched a 4 km grid for the actual lip, scoring high ground with
  // a big drop close by and a steep face. The winner is 36.0616, -112.1076: 2151 m, with 975 m
  // falling away within a single kilometre at a 51 degree face — which is exactly Mather Point, the
  // published visitor-centre overlook. Pleasing, and measured rather than assumed.
  //
  // The deepest ground lies NORTHEAST, so that is the way to look.
  { key: 'Digit2', name: 'Grand Canyon (Mather Point)', lat: 36.0616, lon: -112.1076, facingDeg: 45 },
  // B3 — DUBAI. Geoff: "make it B3 to jump to it."
  //
  // Dubai Marina, which is the densest cluster of tall towers anywhere on Earth and therefore the
  // best place to fight AMONG buildings rather than beside them. Downtown has the Burj Khalifa and
  // is a short walk northeast along Sheikh Zayed Road; the whole 20 km strip is loaded, so walking
  // between districts works.
  //
  // Facing northeast, up the line of the Marina towers, so the skyline is in frame on arrival
  // rather than behind you.
  { key: 'Digit3', name: 'Dubai Marina', lat: 25.0805, lon: 55.1403, facingDeg: 45 },

  // Matterhorn lost its number key to Dubai. It is NOT listed here on Digit0, because Digit0 is
  // already taken by "reset size" earlier in the same switch and the site dispatch only covers 1-9 —
  // so an entry here would be a site that silently never fires. It remains reachable through the
  // landmark list on , and . , which is where it is verified to be.
  { key: 'Digit4', name: 'Yosemite',        lat: 37.7459, lon: -119.5332 },
  { key: 'Digit5', name: 'Torres del Paine', lat: -50.9423, lon: -73.4068 },
  { key: 'Digit6', name: 'Fish River Canyon', lat: -27.5833, lon: 17.6167 },
  { key: 'Digit7', name: 'Milford Sound',   lat: -44.6414, lon: 167.8974 },
  { key: 'Digit8', name: 'Zhangjiajie',     lat: 29.3158, lon: 110.4344 },
  { key: 'Digit9', name: 'Aoraki / Mt Cook', lat: -43.5950, lon: 170.1418 },
];

/**
 * B3 IS A TOUR, NOT A PLACE. Press it again to move to the next district.
 *
 * Geoff: "I don't see the Burj Khalifa and downtown area where it should be."
 *
 * It was there — the bake puts the tower within 43 m of its real coordinates — but B3 landed in the
 * Marina, and Downtown is EIGHTEEN AND A HALF KILOMETRES from the Marina. That is a grey box a
 * degree and a half wide on the horizon, which is not "seeing the Burj Khalifa", and no amount of
 * walking makes it a reasonable way to reach it.
 *
 * Since all four districts are loaded at once and the whole point was to have all four, the key
 * cycles them. One press per district, in the order they run up the coast.
 */
const DUBAI_STOPS: { name: string; lat: number; lon: number; facingDeg: number }[] = [
  // Facing northeast up the line of the Marina towers, so the skyline is in frame on arrival.
  { name: 'Dubai Marina', lat: 25.0805, lon: 55.1403, facingDeg: 45 },
  // The Palm's trunk, looking out along the fronds — the one place the islands read as islands.
  { name: 'Palm Jumeirah', lat: 25.1124, lon: 55.1390, facingDeg: 300 },
  // Standing off the Burj Khalifa, far enough back that all 522 m of it fits above a Kaiju's eye
  // line, and facing it. Closer and you are inside the podium looking at a wall.
  { name: 'Downtown / Burj Khalifa', lat: 25.1880, lon: 55.2650, facingDeg: 40 },
  // Sheikh Zayed Road, looking down the canyon of towers that lines it.
  { name: 'Sheikh Zayed Road', lat: 25.2175, lon: 55.2825, facingDeg: 225 },
];
let dubaiStop = -1;

/**
 * THE SCALE SHOT — camera at human eye height with the crowd between you and the Kaiju.
 *
 * ONE PLACEMENT PATH, and this is why. Geoff: "why does it not sink into the ground in the
 * himalayas but it does in the grand canyon? why is each location on the globe getting different
 * rules and controls? that's stupid and not supposed to be like that."
 *
 * He is exactly right, and the cause was not the location at all — it was that I had written TWO
 * setup functions. Everest went through startArenaHere and dropped the Kaiju from one body height,
 * so gravity and the ground snap settled it correctly. The Grand Canyon went through a separate
 * function of mine that placed it with a drop of ZERO, taking a different route through the physics
 * and inheriting a different bug. Two locations, two code paths, two behaviours — from the same
 * planet and the same creature.
 *
 * So this no longer places anything. It calls the ONE placement path every site uses and then only
 * changes where the CAMERA is and how the crowd is arranged. If the Kaiju stands correctly at
 * Everest it now stands correctly here, necessarily, because it is the same code.
 */
/** How far back the viewer stands, and how tall they are. */
const VIEW_M = 500;
const EYE_M = 1.8;

function startScaleView(
  camera: THREE.Camera, lat: number, lon: number, siteName: string, facingDeg?: number,
): void {
  // Identical placement to every other site. No special cases.
  startArenaHere(camera, lat, lon, siteName, facingDeg);

  // ...and identical CAMERA to every other site too, now. This is the whole of the difference: the
  // same orbit camera, dialled out to 500 m and down to a person's eye height. It used to be a
  // second camera with its own rules, which is how the scale view ended up unable to rotate, with
  // a ground clamp that measured the wrong ground, and with a zoom that overshot 17x.
  setChaseShot(VIEW_M, EYE_M);

  // Where the camera will therefore be: directly behind the Kaiju, 500 m back along its facing.
  // Computed rather than read, because the camera itself does not move until the next frame and
  // the crowd needs to be laid out along that line now.
  const kaijuDir = playerBody.dir.clone().normalize();
  const camDir = kaijuDir.clone().multiplyScalar(PLANET_RADIUS)
    .addScaledVector(playerBody.forward, -(VIEW_M / METRES_PER_UNIT))
    .normalize();

  setCrowdCorridor(camDir, kaijuDir);
  setCrowd(true);
  console.log(
    `[kaiju] SCALE VIEW at ${siteName}: eye ${EYE_M} m, Kaiju ${VIEW_M} m away and `
    + `${ARENA_HEIGHT * METRES_PER_UNIT} m tall, 200 people between.`,
  );
}

/**
 * THE ONE PLACEMENT PATH. Every site, every key, every landing goes through this.
 *
 * It used to be one of two, and the other one placed the Kaiju differently — which is how the same
 * creature on the same planet ended up standing correctly on Everest and sunk at the Grand Canyon.
 * Anything that wants a different VIEW calls this first and then moves the camera.
 */
/**
 * A tangent vector pointing along a compass bearing at `dir`. 0 = north, 90 = east.
 *
 * Needed because arriving somewhere spectacular facing an arbitrary direction wastes it: at the
 * canyon rim the drop is to the northeast, and a Kaiju placed with "any tangent will do" has a
 * three-in-four chance of standing with its back to the view.
 */
function bearingTangent(dir: THREE.Vector3, degrees: number, out: THREE.Vector3): THREE.Vector3 {
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east).normalize();
  const r = (degrees * Math.PI) / 180;
  return out.copy(north).multiplyScalar(Math.cos(r)).addScaledVector(east, Math.sin(r)).normalize();
}

function startArenaHere(
  camera: THREE.Camera, lat?: number, lon?: number, siteName = 'Mount Everest', facingDeg?: number,
): void {
  // Reset anything a previous scale shot changed, so no site inherits another site's state.
  resetChaseShot();
  setCrowdCorridor(null);
  setKaijuHeight(ARENA_HEIGHT);
  const dir = initArena(17, lat, lon);
  const face = new THREE.Vector3();
  if (facingDeg != null) {
    bearingTangent(dir, facingDeg, face);
  } else {
    face.copy(new THREE.Vector3(0, 1, 0).cross(dir));
    if (face.lengthSq() < 1e-6) face.set(1, 0, 0);
    face.normalize();
  }
  // Drop from one body height: unmistakably a fall, without a long wait before you can move.
  dropKaijuAt(dir, face, 1);
  const surface = dir.clone().multiplyScalar(
    PLANET_RADIUS + (sampleGlobeSurface(dir.x, dir.y, dir.z) ?? 0) / METRES_PER_UNIT,
  );
  camera.position.copy(surface)
    .addScaledVector(dir, ARENA_HEIGHT * 2.2)
    .addScaledVector(face, -ARENA_HEIGHT * 4.2);

  // DO NOT START INSIDE THE MOUNTAIN.
  //
  // The chase camera sits behind and above the Kaiju, and on a peak "behind" is very often INTO
  // the slope — at Everest it opened underground, which is disorienting and looks broken. Sample
  // the terrain at the camera's OWN position and lift it clear if it is below ground.
  {
    const camDir = camera.position.clone().normalize();
    const groundAtCam = sampleGlobeSurface(camDir.x, camDir.y, camDir.z);
    if (groundAtCam != null) {
      const minR = PLANET_RADIUS + groundAtCam / METRES_PER_UNIT + ARENA_HEIGHT * 0.9;
      if (camera.position.length() < minR) camera.position.setLength(minR);
    }
  }
  camera.lookAt(surface.clone().addScaledVector(dir, ARENA_HEIGHT * 0.55));
  // The crowd comes with the battle. They are the ruler that makes the Kaiju's size read, so
  // hiding them behind a key meant the scale was only visible if you knew to ask for it.
  setCrowd(true);
  console.log(`[kaiju] battle started at ${siteName} — 4 Kaiju + 200 people`);
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
          // The crowd comes with you. Landing somewhere is exactly when the scale needs reading.
          setCrowd(true);
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
        // NUMBER KEYS: stage the battle somewhere else. 1 Everest, 2 Grand Canyon, and so on.
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
          const site = ARENA_SITES.find((x) => x.key === e.code);
          if (!site) break;
          // 2 is the Grand Canyon SCALE SHOT, per Geoff. The others are ordinary battles.
          if (e.code === 'Digit2') startScaleView(camera, site.lat, site.lon, site.name, site.facingDeg);
          // 3 tours Dubai's four districts, one per press — see DUBAI_STOPS.
          else if (e.code === 'Digit3') {
            dubaiStop = (dubaiStop + 1) % DUBAI_STOPS.length;
            const s = DUBAI_STOPS[dubaiStop];
            startArenaHere(camera, s.lat, s.lon, `${s.name}  (B3 again for the next district)`, s.facingDeg);
          } else startArenaHere(camera, site.lat, site.lon, site.name, site.facingDeg);
          break;
        }
        // O — OUTLINE THE COLLIDERS. See KaijuColliderDebug: four wrong diagnoses in a row about
        // where the bullets are stopping is three too many to keep guessing.
        case 'KeyO': toggleColliderDebug(); break;
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
          setCrowd(true);
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
      {/* EACH IN ITS OWN BOUNDARY.
          These are siblings, so before this a single failing model — a 404 on a character glb, a
          bad skeleton, a throw inside useGLTF — unmounted the whole subtree and took the PLAYER'S
          Kaiju down with it. "No Kaiju at all, not even my own" has exactly that shape, and it is
          worth making structurally impossible whatever the specific cause turns out to be. */}
      <GlobeErrorBoundary label="kaiju-arena">
        <KaijuArenaScene playerControlled />
      </GlobeErrorBoundary>
      <GlobeErrorBoundary label="kaiju-crowd">
        <KaijuCrowd />
      </GlobeErrorBoundary>
      {/* The gunfire is its own boundary and its own layer on purpose: it OUTLIVES the shots. A
          tracer fired the instant the crowd is switched off still has to finish fading, and the
          sparks on the Kaiju burn for a third of a second after that. Hanging this off the crowd
          would cut every effect dead the moment the people vanished. */}
      <GlobeErrorBoundary label="kaiju-gunfire">
        <KaijuGunfireFx />
      </GlobeErrorBoundary>
      <GlobeErrorBoundary label="kaiju-shouts">
        <KaijuShoutsFx />
      </GlobeErrorBoundary>
      <GlobeErrorBoundary label="kaiju-colliders">
        <KaijuColliderDebug />
      </GlobeErrorBoundary>
      {/* Dubai. Its own boundary: a missing or malformed city file must leave a Kaiju map, not a
          white screen — and the loader already returns null rather than throwing for that reason. */}
      <GlobeErrorBoundary label="kaiju-city">
        <KaijuCity />
      </GlobeErrorBoundary>
    </>
  );
}
