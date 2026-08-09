// kaijuAudio — footsteps, roars, and sound that takes time to arrive.
//
// Two things Geoff asked for, and they interact:
//
//   ONE SHOT PER STEP. "You should always play one of these for each step the animation takes.
//   But there should be a random amount of volume, speed, and pitch applied... +-10% on each."
//   The old version looped a whole footstep track and rate-shifted it, which never lands with the
//   feet and repeats audibly. Now a single stomp fires per stride, each one slightly different.
//
//   SOUND THAT TRAVELS. At 100 m per unit a Kaiju 1 km away is 2.9 seconds of delay. See
//   docs/KAIJU_ACOUSTICS.md — this is layer 1, the cheap one, and it is the piece that makes the
//   scale audible rather than merely visible.
//
// A NOTE ON "SPEED AND PITCH" AS SEPARATE KNOBS. For a sampled sound they are the same knob:
// `playbackRate` and `detune` both fold into one rate, so slowing a sample also lowers it, exactly
// like a record. Truly independent pitch needs a phase vocoder, which is not worth it here — and
// for a footstep, varying them together is what you actually want, since a heavier-sounding step
// really is both slower and lower. So volume varies independently, and rate carries speed+pitch.

import * as THREE from 'three';
import { getAudioContext, loadAudioBuffer } from '@/lib/spatialAudio';
import { toRenderX, toRenderY, toRenderZ } from '@/lib/renderSpace';
import { type KaijuBody } from './kaijuBody';
import { METRES_PER_UNIT } from './cubeSphere';
import { rand } from './kaijuRandom';

export const FOOTSTEP_URL = '/kaiju_footstep_one.mp3';
export const ROAR_URL = '/kaiju_roar.mp3';

/** ±10% on volume and on rate, per Geoff. */
const VARY = 0.10;

/**
 * Stride length as a fraction of body height.
 *
 * A 300 m biped has 150 m legs, so its steps are enormous and infrequent, and that is a big part
 * of why the thing reads as huge — a creature taking human-frequency steps reads as human-sized
 * however tall you draw it.
 *
 * 0.25 rather than a strict 0.5 of body height, tuned to the WALK CYCLE rather than to leg length:
 * the clips play at about 0.2x for a creature this size, so a cycle lasts roughly six seconds and
 * lands two footfalls in it. That gives a step every ~2.8 s walking and ~0.9 s running, which is
 * what the animation is actually doing. A strict leg-length stride gave 5.5 s and drifted out of
 * step with the feet, which is the one thing footstep audio must never do.
 */
const STRIDE_FRAC = 0.25;

/** Metres per second. Real. Scaled by the setting below so it can be tuned by feel. */
const SPEED_OF_SOUND_MS = 343;
/**
 * Multiplier on the speed of sound. 1 = real physics.
 *
 * Exposed because the honest warning in the acoustics doc applies: at real speed a footstep from
 * 2 km away arrives six seconds late, which is dramatic and can also be disorienting, since audio
 * stops meaning "something is there" and starts meaning "something WAS there". Film compresses
 * this constantly; so can we.
 */
let soundSpeedScale = 1;
export function setSoundSpeedScale(v: number): void { soundSpeedScale = Math.max(0.2, v); }
export function getSoundSpeedScale(): number { return soundSpeedScale; }

/** Distance in units -> delay in seconds. */
export function propagationDelay(distanceUnits: number): number {
  const metres = distanceUnits * METRES_PER_UNIT;
  return metres / (SPEED_OF_SOUND_MS * soundSpeedScale);
}

const _pos = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Play a one-shot at a world position, arriving when the sound would actually get there.
 *
 * The position is SNAPSHOT at emission. That matters more than it looks: a sound that takes three
 * seconds to arrive must be placed where the creature was when it made the noise, not where it has
 * since walked to. Reading the emitter's live position at playback time is the classic bug here.
 */
/**
 * One shared output stage with a compressor, so overlapping sounds cannot clip.
 *
 * Everything used to connect straight to the destination, and Web Audio simply sums — so a handful
 * of overlapping 0.85-gain stomps exceeded full scale and clipped, which is a harsh crackle that
 * reads as something being badly wrong rather than as loudness.
 */
let busGain: GainNode | null = null;
function bus(ctx: AudioContext): GainNode {
  if (busGain) return busGain;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  g.connect(comp);
  comp.connect(ctx.destination);
  busGain = g;
  return g;
}

export async function playKaijuSound(
  url: string,
  worldPos: THREE.Vector3,
  listenerPos: THREE.Vector3,
  listenerDir: THREE.Vector3,
  opts: {
    volume?: number; rate?: number; refUnits?: number; maxUnits?: number;
    rolloff?: number; panning?: PanningModelType; reverb?: boolean; tiltDb?: number;
    bassDb?: number; cutHz?: number;
  } = {},
): Promise<void> {
  const buffer = await loadAudioBuffer(url);
  if (buffer) playKaijuBuffer(buffer, worldPos, listenerPos, listenerDir, opts);
}

/**
 * The same thing, from a buffer you already hold.
 *
 * Split out so a sound that is GENERATED rather than loaded gets the identical treatment —
 * propagation delay, air absorption, 3D panning, the shared compressor. The rifle fire is
 * synthesised (there is no US service-rifle sample in this project), and it would have been very
 * easy to give it its own quietly different playback path and then spend a day wondering why one
 * sound obeyed the speed of sound and another did not.
 */
/**
 * ONE reverb for the whole battlefield, and the reason distance is audible at all.
 *
 * Geoff: "the ricochets... I think the sound itself would warp over that kind of distance, can you
 * research how sound distorts over long distances in the air?"
 *
 * The research says two things happen, and only one of them was implemented here.
 *
 * AIR ABSORPTION eats high frequencies far faster than low ones — roughly 20 dB above 1 kHz by two
 * miles — so the sharp crack of a gunshot is gone at distance and what is left is a low thump. That
 * was already here as a lowpass, but far too gentle: it put the corner at 8 kHz a kilometre out,
 * where reality is nearer 3.
 *
 * THE TAIL is the one that was missing, and it is the bigger cue by a distance. A far-off gunshot
 * does not just get quieter and duller — it stops being an EVENT and becomes a roll, because the
 * report arrives smeared by reflections off ground and terrain and by thermal turbulence in the air
 * it crossed. It is exactly why distant thunder rumbles for seconds and close thunder is a single
 * bang, and it is the difference between "quiet gunshot" and "gunshot a mile away".
 *
 * Done as ONE shared convolver that everything sends to, with the send level rising with distance.
 * A reverb per sound would be a convolution per sound, which at nine shots a second is not affordable
 * — this is one node for the entire scene, and the only per-sound cost is a gain.
 */
let reverbIn: GainNode | null = null;
function distanceReverb(ctx: AudioContext): GainNode {
  if (reverbIn) return reverbIn;
  // A procedurally generated impulse response: noise under a decaying envelope, darkened as it
  // decays, because late reflections have crossed more air than early ones.
  const seconds = 1.8;
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // A short gap before the first reflections: sound has to reach something and come back.
      const pre = t < 0.03 ? 0 : 1;
      const env = Math.exp(-t * 2.6);
      lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.28 * (t / seconds));
      d[i] = lp * env * pre;
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const inGain = ctx.createGain();
  inGain.gain.value = 1;
  inGain.connect(conv);
  conv.connect(bus(ctx));
  reverbIn = inGain;
  return inGain;
}

export function playKaijuBuffer(
  buffer: AudioBuffer,
  worldPos: THREE.Vector3,
  listenerPos: THREE.Vector3,
  listenerDir: THREE.Vector3,
  opts: {
    volume?: number; rate?: number; refUnits?: number; maxUnits?: number;
    rolloff?: number; panning?: PanningModelType; reverb?: boolean; tiltDb?: number;
    bassDb?: number; cutHz?: number;
  } = {},
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const sx = worldPos.x, sy = worldPos.y, sz = worldPos.z;
  const distUnits = _d.set(sx, sy, sz).distanceTo(listenerPos);
  const delay = propagationDelay(distUnits);
  // Beyond about 25 km the delay is over a minute and the level is inaudible; do not schedule it.
  if (delay > 60) return;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = opts.rate ?? 1;

  const gain = ctx.createGain();
  gain.gain.value = opts.volume ?? 0.8;

  // AIR ABSORPTION. High frequencies die first over distance, which is why far-off thunder is a
  // rumble and close thunder is a crack.
  //
  // The divisor was 1.4, which put the corner at 8 kHz a kilometre away. Published figures give
  // roughly 20 dB of absorption above 1 kHz by two miles, so the crack of a rifle is simply GONE at
  // that range and what survives is a low thump. 6 gives about 3 kHz at a kilometre and 1 kHz at
  // three, which is the right shape.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const km = (distUnits * METRES_PER_UNIT) / 1000;
  lp.frequency.value = Math.max(260, 20000 / (1 + km * 6));

  // A TONE TILT, per sound.
  //
  // Playback rate changes pitch and length together — that is what resampling IS, and there is no
  // cheap way to move one without the other in a browser. So variety that is NOT length comes from
  // here: a shelf that brightens or dulls the sound a couple of dB. Two shots at the same rate still
  // do not sound like the same recording.
  let tilt: BiquadFilterNode | null = null;
  if (opts.tiltDb) {
    tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 1400;
    tilt.gain.value = opts.tiltDb;
  }

  // WEIGHT. A low shelf, for sounds that need to come from something big.
  //
  // Boosting the bottom is only half of it — the other half is `cutHz` below, which takes the top
  // off. A small, hard sound is small because of what is UP THERE, not because of what is missing
  // underneath, so adding bass to a bright sample makes it a bright sample with bass. Both ends have
  // to move for the size to change.
  let bass: BiquadFilterNode | null = null;
  if (opts.bassDb) {
    bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 260;
    bass.gain.value = opts.bassDb;
  }
  let cut: BiquadFilterNode | null = null;
  if (opts.cutHz) {
    cut = ctx.createBiquadFilter();
    cut.type = 'lowpass';
    cut.frequency.value = opts.cutHz;
  }

  const panner = ctx.createPanner();
  // EQUALPOWER, not HRTF, when asked for. HRTF convolves every sound against a head model — lovely
  // for a handful of sources and ruinous at nine a second, which is the rate the rifles fire at.
  panner.panningModel = opts.panning ?? 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = opts.refUnits ?? 12;
  panner.maxDistance = opts.maxUnits ?? 260;
  panner.rolloffFactor = opts.rolloff ?? 1.0;
  if (panner.positionX) {
    panner.positionX.value = toRenderX(sx);
    panner.positionY.value = toRenderY(sy);
    panner.positionZ.value = toRenderZ(sz);
  } else panner.setPosition(toRenderX(sx), toRenderY(sy), toRenderZ(sz));

  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = listenerPos.x; l.positionY.value = listenerPos.y; l.positionZ.value = listenerPos.z;
    l.forwardX.value = listenerDir.x; l.forwardY.value = listenerDir.y; l.forwardZ.value = listenerDir.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
    l.setOrientation(listenerDir.x, listenerDir.y, listenerDir.z, 0, 1, 0);
  }

  // Chain whatever is present, in order, without assuming any of it is.
  let node: AudioNode = src;
  for (const n of [lp, tilt, bass, cut]) { if (n) { node.connect(n); node = n; } }
  node.connect(gain);
  gain.connect(panner); panner.connect(bus(ctx));

  // THE DISTANCE TAIL. Nothing at point-blank, most of the sound by a couple of kilometres — which
  // is what turns a crack into a roll and is the strongest single cue that something is far away.
  let send: GainNode | null = null;
  if (opts.reverb !== false) {
    const wet = Math.min(0.85, Math.max(0, (km - 0.15) / 2.2));
    if (wet > 0.02) {
      send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send);
      send.connect(distanceReverb(ctx));
    }
  }

  // The whole point: start it LATER, by however long the sound takes to cross the distance.
  src.start(ctx.currentTime + delay);
  const stopAt = ctx.currentTime + delay + buffer.duration / Math.max(0.05, src.playbackRate.value) + 0.1;
  src.stop(stopAt);

  // TAKE THE NODES BACK DOWN AGAIN.
  //
  // Geoff: "the game got slower and slower until it was so slow it stopped... there may be a memory
  // leak." There was, and this is it. Every sound built four or five Web Audio nodes and left every
  // one of them connected to the output for the life of the page. At the handful of roars and
  // footsteps this was written for that was survivable; at nine rifle cracks and six ricochets a
  // second it is nine hundred permanently live nodes a minute, most of them HRTF panners, and the
  // audio thread strangles the whole tab.
  //
  // `onended` fires when the source finishes, which is the moment the rest of the chain stops being
  // able to matter.
  src.onended = () => {
    try {
      src.disconnect(); lp.disconnect(); tilt?.disconnect(); bass?.disconnect(); cut?.disconnect();
      gain.disconnect(); panner.disconnect(); send?.disconnect();
    } catch { /* already torn down */ }
  };
}

// --- footsteps -----------------------------------------------------------------------------------

/** Distance each Kaiju has walked since its last footfall. Only used without a clip to read. */
const strideAccum = new Map<string, number>();
const _prev = new Map<string, THREE.Vector3>();

/** Where each Kaiju's walk clip was last frame, 0..1, for detecting a footfall crossing. */
const phasePrev = new Map<string, number>();

/**
 * Points in a walk cycle where a foot lands, as a fraction of the clip.
 *
 * Two per cycle — left and right — half a cycle apart. 0.0 and 0.5 is the standard convention for a
 * biped walk clip, which every model here uses. If a clip is ever authored with its contacts
 * elsewhere the two sounds simply lead or lag together, which is far less wrong than the previous
 * arrangement of running on a completely independent clock.
 */
const FOOTFALL_PHASES = [0.0, 0.5];

/**
 * Fire a footstep every time this Kaiju has covered one stride.
 *
 * Triggering on DISTANCE TRAVELLED rather than on a timer means the steps always match the feet,
 * whatever the creature's speed and whatever rate its walk clip happens to be playing at — the two
 * cannot drift apart, because both derive from the same movement.
 */
export function updateKaijuFootsteps(
  id: string,
  body: KaijuBody,
  heightUnits: number,
  listenerPos: THREE.Vector3,
  listenerDir: THREE.Vector3,
  active: boolean,
  dt = 1 / 60,
  /**
   * Where the WALK CLIP is in its cycle, 0..1, if the renderer knows.
   *
   * Geoff: "His footsteps seem to happen around every 3.7 seconds... that's a guess but would be
   * good timing for when they hit the ground."
   *
   * He should not have to guess, and the number should not be a constant anyone has to keep in
   * step. Footsteps were paced by DISTANCE (speed x dt against an assumed stride) while the legs
   * were paced by TIME (clip duration / playback rate). Two independent clocks for one physical
   * event, so they drift apart the moment either is retuned — the same duplicated-source-of-truth
   * pattern behind today's other bugs.
   *
   * Given the clip's own phase, a footfall fires at fixed points in the cycle and therefore lands
   * with the visible foot by construction, at whatever cadence the animation actually runs.
   */
  phase01?: number,
): void {
  _pos.copy(body.dir).multiplyScalar(body.radius);

  // MEASURE THE WALK, NOT THE POSITION CHANGE.
  //
  // This used to accumulate the distance between frames, which counts EVERY reason a body moved —
  // including the separation pass shoving four Kaiju apart three times a tick, and knockback. In a
  // brawl that inflated the stride distance enormously and machine-gunned the footstep sample into
  // itself, which is what was clipping the speakers and reading as a roar.
  //
  // body.speed is the walking speed the locomotion actually produced, and nothing else feeds it.
  const moved = body.speed * dt;

  // Airborne, submerged, standing still, or switched off: no footfall, and no accumulation either
  // — a Kaiju should not bank up steps mid-jump and fire them all on landing.
  if (!active || !body.onGround || body.submerged || moved < 1e-6) return;

  // ±10% on each, independently rolled, so no two steps are identical.
  const vary = () => 1 + (rand() * 2 - 1) * VARY;
  const step = () => {
    void playKaijuSound(FOOTSTEP_URL, _pos, listenerPos, listenerDir, {
      volume: 0.55 * vary(),
      rate: vary(),
      refUnits: 10,
      maxUnits: 300,
    });
  };

  // PREFERRED: the clip's own cycle. Two footfalls per cycle, at the points where a walk cycle
  // plants each foot. Whatever rate the animation is playing at — and at Kaiju scale that is about
  // nine seconds a cycle — the sound follows it.
  if (phase01 != null && Number.isFinite(phase01)) {
    const prev = phasePrev.get(id);
    phasePrev.set(id, phase01);
    if (prev != null) {
      // Forward progress since last frame, wrapping at 1. Guards against a paused or reversed clip.
      const delta = (phase01 - prev + 1) % 1;
      if (delta > 0 && delta < 0.5) {
        for (const f of FOOTFALL_PHASES) {
          const d = (f - prev + 1) % 1;
          if (d > 0 && d <= delta) step();
        }
      }
    }
    return;
  }

  // FALLBACK, for anything with no clip to read: pace by distance walked, as before.
  const stride = heightUnits * STRIDE_FRAC;
  let acc = (strideAccum.get(id) ?? 0) + moved;
  if (acc >= stride) {
    acc -= stride;
    step();
  }
  strideAccum.set(id, acc);
}

/** A roar from this Kaiju — the loudest thing it does, so it carries much further. */
export function roar(worldPos: THREE.Vector3, listenerPos: THREE.Vector3, listenerDir: THREE.Vector3): void {
  void playKaijuSound(ROAR_URL, worldPos, listenerPos, listenerDir, {
    volume: 1.0 * (1 + (rand() * 2 - 1) * VARY),
    rate: 1 + (rand() * 2 - 1) * VARY,
    refUnits: 40,
    maxUnits: 900,
  });
}

/**
 * The cry when something is set on fire. Same asset as the roar for now — it is the only scream we
 * have — but pitched down and louder, so it reads as pain rather than as a challenge.
 */
export function scream(worldPos: THREE.Vector3, listenerPos: THREE.Vector3, listenerDir: THREE.Vector3): void {
  void playKaijuSound(ROAR_URL, worldPos, listenerPos, listenerDir, {
    volume: 1.0 * (1 + (rand() * 2 - 1) * VARY),
    rate: 0.82 * (1 + (rand() * 2 - 1) * VARY),
    refUnits: 30,
    maxUnits: 700,
  });
}

export function stopKaijuFootsteps(id: string): void {
  strideAccum.delete(id);
  _prev.delete(id);
  // Drop the remembered clip phase too, or a Kaiju that stops and restarts fires a spurious step
  // on its first frame back from wherever the cycle happened to be left.
  phasePrev.delete(id);
}
export function stopAllKaijuFootsteps(): void {
  strideAccum.clear();
  phasePrev.clear();
  _prev.clear();
}
