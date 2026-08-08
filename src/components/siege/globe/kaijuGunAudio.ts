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

/** Already in this project, and exactly right. */
const RICOCHET_URL = '/ricochet_sound.mp3';

/**
 * Shots we are willing to actually voice, per second.
 *
 * Nine. Below about six the fire reads as sparse and deliberate rather than as a firefight; above a
 * dozen it is mud and costs more. Thirty-six are fired; you hear the nearest nine and they stand in
 * for the rest.
 */
const SHOTS_PER_SEC = 9;
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
 * The synthesised rifle crack.
 *
 * There is no US service-rifle sample in this project — the only gun sound here is a sci-fi one —
 * so it is generated, once, and then pitched and filtered differently on every shot. That last part
 * is the reason this is better than a sample even if we had one: a single .mp3 fired nine times a
 * second is instantly recognisable as a loop, and the one thing that gives away a cheap firefight is
 * hearing the SAME crack over and over.
 *
 * Two layers, which is what a rifle actually is:
 *   THE CRACK  a very short burst of noise, gone in about 30 ms. This is the supersonic snap and
 *              carries the whole sense of "rifle".
 *   THE BODY   a low thump under it, decaying over ~150 ms, which is the muzzle blast. Without it
 *              the shot sounds like a stick breaking.
 *
 * If a real recording is wanted later, this is the only function to replace.
 */
let crackBuffer: AudioBuffer | null = null;
function rifleCrack(ctx: AudioContext): AudioBuffer | null {
  if (crackBuffer) return crackBuffer;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.22);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // The snap: white noise under a very fast exponential decay.
    const snap = (Math.random() * 2 - 1) * Math.exp(-t / 0.012);
    // The blast: a low tone that falls in pitch as it decays, which is what a body of air escaping
    // sounds like. Sweeping the frequency down is what stops it reading as a beep.
    const f = 110 * Math.exp(-t / 0.09) + 45;
    const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.075) * 0.55;
    // A little filtered noise tail for the report bouncing off everything nearby.
    lp += ((Math.random() * 2 - 1) - lp) * 0.08;
    const tail = lp * Math.exp(-t / 0.13) * 0.35;
    d[i] = Math.max(-1, Math.min(1, snap * 0.9 + body + tail));
  }
  crackBuffer = buf;
  return buf;
}

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

    const buf = rifleCrack(ctx);
    let played = 0;
    for (const s of shots) {
      if (shotTokens < 1 || s.dist > MAX_AUDIBLE_UNITS) break;
      shotTokens -= 1;
      played++;
      // Every shot is a different rifle at a different angle. Pitch and level vary per shot, which
      // is what stops nine a second from sounding like one sample on repeat.
      playKaijuBuffer(buf!, s.pos, listenerPos, listenerDir, {
        volume: 0.30 + rand() * 0.10,
        rate: 0.88 + rand() * 0.28,
        // A rifle is a person-sized source: it is loud where you stand and drops off fast. 1.5 units
        // is 150 m, so by half a kilometre it is already a fifth of its level.
        refUnits: 1.5,
        rolloff: 1.4,
        maxUnits: MAX_AUDIBLE_UNITS,
        // Equalpower rather than HRTF. Nine head-model convolutions a second is not worth paying
        // for on a sound whose direction you cannot pick out of a firefight anyway.
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
