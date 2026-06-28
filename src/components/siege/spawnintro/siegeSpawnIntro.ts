// siegeSpawnIntro — the cinematic "spawn intro" state machine. The chosen character arrives facing
// the camera (camera high + behind), the world streams in, a (bypassable) countdown runs while the
// player can fiddle with their loadout, then on the final beat the character turns away and the
// camera dollies down into the back of its head → FPS. Same flow for a challenge or an open-world
// spawn. While active it SUSPENDS SiegeFlyController (the intro owns the camera).
import { useSyncExternalStore } from 'react';

export type IntroPhase = 'off' | 'arrive' | 'loading' | 'countdown' | 'inhabit';

export interface IntroTarget {
  charFile: string;     // e.g. '/siege/characters/pilot_rajax.glb'
  idleClip: string;     // e.g. 'idle_rajax'
  scale: number;        // lineup scale
  minY: number;         // glb-space feet offset
  charHeight: number;   // rendered height (m), for camera framing
  pos: [number, number, number];  // FINAL FPS camera (eye) position
  yaw: number;          // FINAL look yaw (the direction the player ends up facing)
  countdownSec: number; // self-timed countdown length (open-world) — used when countdownEndsAt is absent
  countdownEndsAt?: number;  // absolute performance.now() ms the countdown ends (challenge): the intro
                             // times its turn+dolly to FINISH exactly then, so the player inhabits the
                             // body the instant the real countdown hits zero + wave 1 spawns.
}

let phase: IntroPhase = 'off';
let target: IntroTarget | null = null;
let bypassReq = false;
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };

export const isSiegeIntroActive = (): boolean => phase !== 'off';
export const getIntroPhase = (): IntroPhase => phase;
export const getIntroTarget = (): IntroTarget | null => target;

export function startSiegeIntro(t: IntroTarget): void { target = t; bypassReq = false; phase = 'arrive'; emit(); }

// V1 spawn character (a character-select panel will set this later). Single source of truth for the
// challenge trigger, the open-world trigger, and the debug key.
export const V1_SPAWN_CHAR = {
  charFile: '/siege/characters/pilot_rajax.glb', idleClip: 'idle_rajax',
  scale: 1.140, minY: -0.0002, charHeight: 2.0,
} as const;

// Convenience starter: fire the cinematic at a final eye pose. For a challenge pass countdownEndsAt
// (the real countdown clock); for open-world pass countdownSec (a shorter self-timed beat).
export function startSpawnIntro(
  pos: [number, number, number], yaw: number,
  opts: { countdownSec?: number; countdownEndsAt?: number } = {},
): void {
  console.log('[spawn-intro] startSpawnIntro called — pos', pos, 'sec', opts.countdownSec, 'endsAt', opts.countdownEndsAt);
  startSiegeIntro({ ...V1_SPAWN_CHAR, pos, yaw, countdownSec: opts.countdownSec ?? 10, countdownEndsAt: opts.countdownEndsAt });
}
export function setIntroPhase(p: IntroPhase): void { if (p !== phase) { phase = p; emit(); } }
export function endSiegeIntro(): void { if (phase !== 'off') { phase = 'off'; target = null; emit(); } }
// Player pressed "skip" during the countdown — jump straight to the turn-and-inhabit.
export function requestIntroBypass(): void { bypassReq = true; }
export function consumeIntroBypass(): boolean { const b = bypassReq; bypassReq = false; return b; }

// Subscribe a component to phase changes (the controller toggles PointerLockControls on it).
export function useSiegeIntro(): number {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => version, () => version,
  );
}
