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
import { playKaijuSound, playKaijuBuffer } from './kaijuAudio';
import { getAudioContext } from '@/lib/spatialAudio';
import { METRES_PER_UNIT } from './cubeSphere';
import { fxRand as rand } from './kaijuRandom';

const RICOCHET_URL = '/ricochet_sound.mp3';

/**
 * THE IMPACT THUD — the layer that makes a ricochet sound like it hit something enormous.
 *
 * Geoff: "the ricochet sounds too tinny, like the sound of a tiny bullet or bb-gun... Would it help
 * to make it happen faster, like 50% faster but also much deeper sound?"
 *
 * Faster and deeper are OPPOSITE directions for a sample: speeding it up resamples it HIGHER, which
 * is the tinniness. So the sample goes the other way — slower, deeper, with the top end cut off. But
 * that alone gives a dull thin sound rather than a big one, because size is not something you can
 * filter INTO a recording that never had it.
 *
 * So it is layered. This is the sweetener sound designers put under an impact: a short sine that
 * falls fast in pitch, with a very hard attack. The fall is what reads as mass — a small thing rings
 * at one pitch, a big thing booms and drops. It also puts the SNAP back that slowing the sample took
 * away, which is what Geoff was reaching for with "faster".
 *
 * Generated, once, and pitched per hit. Two sources instead of one, six times a second.
 */
let thudBuffer: AudioBuffer | null = null;
function impactThud(ctx: AudioContext): AudioBuffer {
  if (thudBuffer) return thudBuffer;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.45);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // 190 Hz falling to 42. The sweep, not the pitch, is what makes it read as heavy.
    const f = 42 + 148 * Math.exp(-t / 0.055);
    phase += (2 * Math.PI * f) / sr;
    // Two decays: a fast one for the strike, a slow one for the body ringing after it.
    const env = Math.exp(-t / 0.075) * 0.75 + Math.exp(-t / 0.22) * 0.35;
    // A tiny scrape of noise on the very front, so the attack has teeth rather than being a pure
    // tone appearing out of nowhere.
    const scrape = t < 0.012 ? (Math.random() * 2 - 1) * (1 - t / 0.012) * 0.5 : 0;
    d[i] = Math.max(-1, Math.min(1, Math.sin(phase) * env + scrape));
  }
  thudBuffer = buf;
  return buf;
}

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
/**
 * Rounds striking concrete, per second.
 *
 * Higher than the ricochet budget because in a city most rounds hit a building rather than the
 * Kaiju, and a firefight in Dubai with nothing hitting the buildings sounds like it is happening
 * somewhere else. Still well under the shot rate: this is texture, not events.
 */
const WALL_HITS_PER_SEC = 5;
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
const wallPool = makePool(48);
let shotCount = 0;
let ricCount = 0;
let wallCount = 0;
const shots: Pending[] = [];
const ricochets: Pending[] = [];
const wallHits: Pending[] = [];
let shotTokens = SHOTS_PER_SEC;
let ricTokens = RICOCHETS_PER_SEC;
let wallTokens = WALL_HITS_PER_SEC;

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
 * A round hit a building. Same deal.
 *
 * Geoff: "the sound they make should be like the bullet being shot, but lower pitch and 25% the
 * volume as the original shot fired." So it is literally the same recording — see the flush.
 */
export function noteWallHit(pos: THREE.Vector3): void {
  if (wallCount >= wallPool.length) return;
  wallPool[wallCount].pos.copy(pos);
  wallHits[wallCount] = wallPool[wallCount];
  wallCount++;
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
  wallTokens = Math.min(WALL_HITS_PER_SEC, wallTokens + WALL_HITS_PER_SEC * dt);

  const ctx = getAudioContext();
  if (!ctx) {
    shots.length = 0; ricochets.length = 0; wallHits.length = 0;
    shotCount = 0; ricCount = 0; wallCount = 0;
    return;
  }

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
          // +-15%. Pitch and speed together, which Geoff confirmed is fine — and in a browser it
          // is the only option anyway, since resampling moves both or neither.
          rate: 0.85 + rand() * 0.30,
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
      // THE ZING, slowed and darkened. 0.55-0.7 drops it roughly an octave, and cutting everything
      // above about 3 kHz removes the bb-gun edge — that top end is the whole of what made it sound
      // small. It also comes out longer, which is correct: a big ricochet rings.
      //
      // HALF THE LEVEL, and a REFERENCE DISTANCE that finally means something. Geoff: "The ricochet
      // sounds are much too loud, especially from so far away."
      //
      // Both halves of that had a cause and only one was the volume. Web Audio's inverse model plays
      // everything closer than `refDistance` at FULL level and only begins falling off beyond it —
      // so with the reference at 2 units, every ricochet within TWO HUNDRED METRES was at maximum,
      // and the decay past that started from a level already too high. On a map where the creature
      // being hit is 300 m tall, that is most of them.
      //
      // 0.8 units is 80 m, which is what a sharp impact really sounds like: loud where you stand,
      // gone quickly. With the steeper rolloff and the halved level that is 2x quieter close in and
      // 6x quieter across the battlefield, which is the shape Geoff described rather than a flat cut.
      playKaijuSound(RICOCHET_URL, r.pos, listenerPos, listenerDir, {
        volume: 0.21 + rand() * 0.07,
        rate: 0.55 + rand() * 0.15,
        cutHz: 2600 + rand() * 900,
        bassDb: 6,
        tiltDb: -4 + (rand() * 2 - 1) * 2,
        refUnits: 0.8,
        rolloff: 1.8,
        maxUnits: MAX_AUDIBLE_UNITS,
        panning: 'equalpower',
      });
      // ...AND THE THUD UNDER IT. Same position, same delay, so they arrive together as one event.
      //
      // Its reference was 3 units — THREE HUNDRED METRES at full level, worse than the zing sitting
      // on top of it, and it was never brought into line when the zing was last corrected. A low
      // thump does carry further than a crack, so it keeps a longer reference and a gentler rolloff
      // than the zing does; it does not get to keep one the size of a city block.
      playKaijuBuffer(impactThud(ctx), r.pos, listenerPos, listenerDir, {
        volume: 0.27 + rand() * 0.1,
        rate: 0.85 + rand() * 0.3,
        refUnits: 1.2,
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
