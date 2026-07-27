// kaijuAudio — footsteps for something 300 metres tall.
//
// Geoff supplied the clip and the note that matters: "needs to be slowed down about 50% to sound
// right and match his gait". That is the whole tuning brief, and it happens to agree with the
// physics the rest of this map already runs on — under dynamic similarity a body scaled up by a
// factor S moves its limbs at 1/sqrt(S), so a creature ~160x a human's height steps roughly an
// order of magnitude slower. Halving the clip is a good ear-led approximation of that, and slowing
// a sample also drops its pitch, which is exactly what makes it read as heavy.
//
// Two things it must do beyond "play a sound":
//
//   MATCH THE GAIT. A fixed rate would drift out of sync the moment the Kaiju changed pace, and
//   footsteps that do not land with the feet are worse than none. So the rate tracks the body's
//   actual speed against its own natural walk speed, which is where the 50% sits.
//
//   SCALE THE DISTANCE MODEL. The shared audio helper defaults to a reference distance of 5 and a
//   maximum of 50, tuned for a world where 1 unit is 1 metre. Here 1 unit is 100 metres, so those
//   defaults would make a Kaiju inaudible 500 m away and silent past 5 km. Both are widened so a
//   fight you can see is a fight you can hear.

import * as THREE from 'three';
import { startLoopSound, updateLoopSound, stopLoopSound, type LoopSound } from '@/lib/spatialAudio';
import { toRenderX, toRenderY, toRenderZ } from '@/lib/renderSpace';
import { walkSpeed, type KaijuBody } from './kaijuBody';

export const FOOTSTEP_URL = '/kaiju_footsteps.mp3';

/**
 * Playback rate at a normal walking pace. Geoff's ear, and it is the number to change if it still
 * sounds wrong — everything else here is relative to it.
 */
const BASE_RATE = 0.5;
/**
 * How far the rate may drift from BASE_RATE as the Kaiju speeds up or slows down.
 *
 * Deliberately narrow. Letting it track speed proportionally would push a sprinting Kaiju back to
 * full playback rate, which sounds like a person jogging and throws away the weight the slowdown
 * bought. Running should sound like a faster colossus, not like a lighter one.
 */
const RATE_MIN = 0.72;
const RATE_MAX = 1.55;

/** Loudest the footsteps get, at a full run. */
const MAX_VOLUME = 0.85;
/** Below this fraction of walking speed there is no footfall at all. */
const SILENT_BELOW = 0.12;

/** Reference and maximum distance in UNITS (1 unit = 100 m). ~1 km and ~12 km. */
const REF_DISTANCE = 10;
const MAX_DISTANCE = 120;

interface Entry { loop: LoopSound; }
const loops = new Map<string, Entry>();

const _pos = new THREE.Vector3();

/**
 * Start, update or stop the footsteps for one Kaiju. Safe to call every frame.
 *
 * `id` is anything stable per creature — the arena agent id, or 'player'.
 */
export function updateKaijuFootsteps(
  id: string,
  body: KaijuBody,
  heightUnits: number,
  listenerPos: THREE.Vector3,
  listenerDir: THREE.Vector3,
  active: boolean,
): void {
  const entry = loops.get(id);

  // Not on the ground, not moving, or dead: no footsteps. Airborne is important — a Kaiju mid-jump
  // or mid-glide should be silent, and it is the cheapest possible cue that it has left the ground.
  const natural = walkSpeed(heightUnits);
  const paceFrac = body.speed / Math.max(1e-4, natural);
  const shouldPlay = active && body.onGround && !body.submerged && paceFrac > SILENT_BELOW;

  if (!shouldPlay) {
    if (entry) {
      // Silence it rather than tearing it down: starting a loop is asynchronous (the buffer has to
      // load) so stop/start on every pause would stutter or drop steps entirely.
      updateLoopSound(entry.loop, 0, 0, 0, listenerPos, listenerDir, BASE_RATE, 0);
    }
    return;
  }

  // Feet, not centre of mass — that is where the sound is actually made.
  _pos.copy(body.dir).multiplyScalar(body.radius);
  const x = toRenderX(_pos.x), y = toRenderY(_pos.y), z = toRenderZ(_pos.z);

  const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, paceFrac)) * BASE_RATE;
  // Volume rises with pace but is not proportional to it: a walking Kaiju is still enormous.
  const volume = MAX_VOLUME * Math.min(1, 0.45 + paceFrac * 0.4);

  if (!entry) {
    loops.set(id, {
      loop: startLoopSound(FOOTSTEP_URL, {
        x, y, z, baseVolume: volume, playbackRate: rate,
        refDistance: REF_DISTANCE, maxDistance: MAX_DISTANCE, rolloffFactor: 1.1,
      }),
    });
    return;
  }
  updateLoopSound(entry.loop, x, y, z, listenerPos, listenerDir, rate, volume);
}

/** Tear down one Kaiju's footsteps (it died, or the map unmounted). */
export function stopKaijuFootsteps(id: string): void {
  const e = loops.get(id);
  if (!e) return;
  stopLoopSound(e.loop);
  loops.delete(id);
}

/** Tear down everything. Call when leaving the globe map. */
export function stopAllKaijuFootsteps(): void {
  for (const [, e] of loops) stopLoopSound(e.loop);
  loops.clear();
}
