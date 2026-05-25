// Procedural explosion boom — no audio asset needed.
//
// Combines a low-frequency sine sweep (the "thump") with a filtered
// noise burst (the "boom"). At higher tiers the pitch drops and the
// duration extends so a T10 sounds noticeably heavier than a T1.

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

/**
 * Play a grenade explosion. distance is the distance from the listener
 * (used for volume falloff and a slight muffled-by-distance lowpass).
 * tier scales the boom's mass.
 */
export function playExplosionSound(distance: number, tier: number) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const t = Math.max(1, Math.min(10, tier));

  // Distance falloff (1 / (1 + d/15)). At 0m = full volume.
  const distVol = 1 / (1 + Math.max(0, distance) / 15);

  // Higher tier = lower start pitch + longer duration.
  const startHz = 110 - (t - 1) * 5;  // T1=110, T10=65
  const endHz   = 28 - (t - 1) * 1.5; // T1=28,  T10=14.5
  const sweepDur = 0.45 + (t - 1) * 0.05;
  const noiseDur = 0.55 + (t - 1) * 0.04;

  // ── Low-freq sine sweep (the punch) ──────────────────────────────
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(8, endHz), now + sweepDur);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.9 * distVol, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + sweepDur);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + sweepDur + 0.05);

  // ── Noise burst (the crack) ──────────────────────────────────────
  const sampleRate = ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, Math.ceil(sampleRate * noiseDur), sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  // Distance-muffled cutoff: closer = brighter
  const startCut = 2400 / (1 + distance / 30);
  filter.frequency.setValueAtTime(startCut, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, startCut * 0.08), now + noiseDur);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.55 * distVol, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
}

/** Metallic ping for pin-pull on G press. */
export function playPinPullSound() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/** Brief whoosh for the throw release. */
export function playThrowSound() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const dur = 0.18;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const arr = buf.getChannelData(0);
  for (let i = 0; i < arr.length; i++) {
    // Quick fade-out noise
    const t = i / arr.length;
    arr[i] = (Math.random() * 2 - 1) * (1 - t);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.linearRampToValueAtTime(2200, now + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
}
