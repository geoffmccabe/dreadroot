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
  countdownSec: number; // length of the countdown beat (challenge ~10, open-world shorter)
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
