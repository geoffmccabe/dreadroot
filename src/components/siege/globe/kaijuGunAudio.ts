// kaijuGunAudio — two hundred rifles and a monster being hit, without two hundred sounds.
//
// Geoff: "each time a soldier fires, we should hear it... but also we have to account for the speed
// of sound and the distance travelled. We may need to find a way to vastly simplify the complexity
// of so many guns being fire and the speed of sound for 3d sound?"
//
// He is right that it needs simplifying, and the reason is worth stating because it decides the
// whole design: two hundred soldiers firing every 1-10 seconds is about THIRTY-SIX SHOTS A SECOND.
// Every one of those as its own delayed, panned, filtered voice is a hundred-odd Web Audio nodes
// created and torn down every second, and it would not even sound better — thirty-six cracks a
// second inside a few hundred metres of each other arrive as one continuous roar however faithfully
// each is placed. The faithfulness is inaudible and the cost is not.
//
// SO: A TOKEN BUDGET, SPENT ON THE NEAREST.
//
// Every shot is offered to this module. Each frame it takes the ones that arrived, sorts them by
// distance, and plays only as many as the budget allows — nearest first, because those are the ones
// whose direction and timing you can actually perceive. The rest are dropped, and the ones that DO
// play are made slightly louder to stand for them. That is what real games do and it is why a
// firefight sounds like a firefight rather than like a machine gun with a stutter.
//
// The speed of sound still applies to every shot that plays, so a distant volley still arrives late.
// That is the part worth keeping: at 100 m per unit, a rifle 1.5 km away is four and a half seconds
// behind the muzzle flash, and seeing the flash before hearing the crack is most of what makes a
// battlefield feel large.

import * as THREE from 'three';
import { playKaijuSound } from './kaijuAudio';
import { getAudioContext } from '@/lib/spatialAudio';
import { METRES_PER_UNIT } from './cubeSphere';
import { fxRand as rand } from './kaijuRandom';

/** Already in this project, and exactly right. */
const RICOCHET_URL = '/ricochet_sound.mp3';

/**
 * Bursts we are willing to actually voice, per second.
 *
 * TWO, not nine, and the recordings are why. These are not single cracks — they run two to four
 * seconds of automatic fire each. At nine a second there would be twenty-odd overlapping at any
 * moment, which is not a firefight, it is white noise. At two a second roughly six overlap, which
 * IS what two hundred rifles sound like: continuous, layered, with individual bursts still audible
 * inside it. Thirty-six shots a second are fired; you hear the nearest two as bursts and they stand
 * in for the rest.
 */
const SHOTS_PER_SEC = 2;
/** Ricochets are rarer and more interesting, so they get their own smaller budget. */
const RICOCHETS_PER_SEC = 6;
/** Past this, a rifle crack is inaudible against everything else and is not worth a voice. */
const MAX_AUDIBLE_UNITS = 22;   // 2.2 km

interface Pending { pos: THREE.Vector3; dist: number }

/**
 * POOLED, not allocated.
 *
 * Thirty-six shots a second, each cloning a vector into a fresh object, is a couple of thousand
 * short-lived allocations a minute for the collector to sweep. It is not the leak that stopped the
 * game — that was the audio graph — but a scene that quietly generates garbage in its hot loop is
 * how a frame-time creep starts, and this costs nothing to avoid.
 */
function makePool(n: number): Pending[] {
  const out: Pending[] = [];
  for (let i = 0; i < n; i++) out.push({ pos: new THREE.Vector3(), dist: 0 });
  return out;
}
const shotPool = makePool(64);
const ricPool = makePool(32);
let shotCount = 0;
let ricCount = 0;
const shots: Pending[] = [];
const ricochets: Pending[] = [];
let shotTokens = SHOTS_PER_SEC;
let ricTokens = RICOCHETS_PER_SEC;

/** Live counters, so "why can I not hear it" is answerable by looking. */
export const gunAudioDiag = { offered: 0, played: 0, dropped: 0 };

/**
 * A soldier fired. Cheap, and deliberately does NOT play anything.
 *
 * Called from the crowd's own loop, which is the hot path — so this records a position and returns.
 * Deciding what is worth hearing needs to know about all of this frame's shots at once, and that
 * can only happen after they have all arrived.
 */
export function noteGunshot(pos: THREE.Vector3): void {
  if (shotCount >= shotPool.length) return;   // a hard ceiling; the frame is about to sort these
  shotPool[shotCount].pos.copy(pos);
  shots[shotCount] = shotPool[shotCount];
  shotCount++;
  gunAudioDiag.offered++;
}

/** A round struck a Kaiju. Same deal. */
export function noteRicochet(pos: THREE.Vector3): void {
  if (ricCount >= ricPool.length) return;
  ricPool[ricCount].pos.copy(pos);
  ricochets[ricCount] = ricPool[ricCount];
  ricCount++;
}

/**
 * Geoff's five machine-gun recordings, played at random.
 *
 * "I made these 5 sounds for the sounds of the soldiers firing. When they fire, play one of these
 * randomly. Also modify each shot so it's +-10% higher/lower pitch and +-10% higher/lower speed too
 * ... that will give it more organic sound."
 *
 * Which replaces the synthesised crack entirely — a real recording beats a generated one, and five
 * of them beats any amount of cleverness applied to a single sample.
 *
 * ON PITCH AND SPEED BEING TWO KNOBS: in a browser they are ONE. Changing a sample's playback rate
 * resamples it, so it gets higher AND shorter together — that is what resampling is, and separating
 * them needs a pitch-shifter, which is a real cost at this rate. So the rate carries the ±10% (both
 * at once, which is the organic wobble that was actually wanted), and a per-shot TONE TILT carries
 * the rest: a couple of dB brighter or duller, which changes the character without touching the
 * length. Two bursts at the same rate still do not sound like the same recording.
 */
const BURST_URLS = [
  '/light_machinggun_v1.mp3',
  '/light_machinggun_v2.mp3',
  '/light_machinggun_v3.mp3',
  '/light_machinggun_v4.mp3',
  '/light_machinggun_v5.mp3',
];

/**
 * Decide what is worth hearing and play it. Called once a frame.
 *
 * The token bucket refills with time rather than per frame, so the rate is the same at 30 fps as at
 * 144 — a budget of "N per frame" would make a fast machine louder than a slow one, which is the
 * classic way this goes wrong.
 */
export function flushGunAudio(
  dt: number, listenerPos: THREE.Vector3, listenerDir: THREE.Vector3,
): void {
  shotTokens = Math.min(SHOTS_PER_SEC, shotTokens + SHOTS_PER_SEC * dt);
  ricTokens = Math.min(RICOCHETS_PER_SEC, ricTokens + RICOCHETS_PER_SEC * dt);

  const ctx = getAudioContext();
  if (!ctx) { shots.length = 0; ricochets.length = 0; shotCount = 0; ricCount = 0; return; }

  // --- rifle fire ------------------------------------------------------------------------------
  if (shotCount) {
    shots.length = shotCount;
    for (const s of shots) s.dist = s.pos.distanceTo(listenerPos);
    // NEAREST FIRST. Those are the ones whose direction and timing can be perceived at all; a shot
    // two kilometres away is a texture, and dropping it costs nothing anybody can hear.
    shots.sort((a, b) => a.dist - b.dist);

    let played = 0;
    for (const s of shots) {
      if (shotTokens < 1 || s.dist > MAX_AUDIBLE_UNITS) break;
      shotTokens -= 1;
      played++;
      playKaijuSound(BURST_URLS[Math.floor(rand() * BURST_URLS.length) % BURST_URLS.length],
        s.pos, listenerPos, listenerDir, {
          volume: 0.34 + rand() * 0.12,
          // +-10%, as asked. One knob, because in a browser pitch and speed are one knob.
          rate: 0.90 + rand() * 0.20,
          // ...and the tone tilt for the variety that rate cannot give: +-3 dB of brightness.
          tiltDb: (rand() * 2 - 1) * 3,
          // A rifle is a person-sized source: loud where you stand, gone quickly. 1.5 units is
          // 150 m, so by half a kilometre it is already a fifth of its level.
          refUnits: 1.5,
          rolloff: 1.4,
          maxUnits: MAX_AUDIBLE_UNITS,
          // Equalpower rather than HRTF. Head-model convolution is not worth paying for on a sound
          // whose direction nobody can pick out of a firefight anyway.
          panning: 'equalpower',
        });
    }
    gunAudioDiag.played += played;
    gunAudioDiag.dropped += shots.length - played;
    shots.length = 0;
    shotCount = 0;
  }

  // --- ricochets -------------------------------------------------------------------------------
  if (ricCount) {
    ricochets.length = ricCount;
    for (const r of ricochets) r.dist = r.pos.distanceTo(listenerPos);
    ricochets.sort((a, b) => a.dist - b.dist);
    for (const r of ricochets) {
      if (ricTokens < 1 || r.dist > MAX_AUDIBLE_UNITS) break;
      ricTokens -= 1;
      playKaijuSound(RICOCHET_URL, r.pos, listenerPos, listenerDir, {
        volume: 0.5 + rand() * 0.18,
        rate: 0.85 + rand() * 0.4,
        tiltDb: (rand() * 2 - 1) * 3,
        // 2 units, not 5. Geoff: "I could hear the ricochets but they sound like they're coming
        // from right on top of me and don't sound far away." At 5 the reference distance was 500 m
        // — which is roughly where the Kaiju STANDS in the scale view, so every impact was playing
        // at full reference level and of course sounded like it was in the room. At 2 units (200 m)
        // with a steeper rolloff, an impact half a kilometre away arrives at about a fifth, and the
        // air absorption and the reverb tail do the rest.
        refUnits: 2,
        rolloff: 1.5,
        maxUnits: MAX_AUDIBLE_UNITS,
        panning: 'equalpower',
      });
    }
    ricochets.length = 0;
    ricCount = 0;
  }
}

/** Metres the sound of a shot has to travel before it is dropped. Exposed for the readout. */
export const audibleMetres = MAX_AUDIBLE_UNITS * METRES_PER_UNIT;
