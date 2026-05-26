// Pin-pull SFX uses a recorded MP3 (/grenade-pin-pull.mp3, preloaded
// by FortressControls). The throw whoosh is still procedural since
// it's a 180ms noise burst with no obvious "right" sample.

import { playSound } from '@/lib/spatialAudio';

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

/** Pin-pull SFX on G press. Flat-volume UI feedback (not spatial). */
export function playPinPullSound() {
  void playSound('/grenade-pin-pull.mp3', 0.7);
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
