// siegeCharLineupState — the toggleable character lineup (the Starblind characters). Toggled with
// "&&&", appears on the ground in front of the player in any SWW world. M/N cycle the shared
// animation (same Mixamo skeleton + clips on every character, so one index drives all). Each
// animation has a 1-based number for reference.
import { useSyncExternalStore } from 'react';

// scale brings each model to its real height; minY (glb-space feet) lets the renderer keep the
// scaled feet on the ground.  Ash → 2.0 m incl. hat (raw 1.783), Thorn → 1.4 m (raw 2.010).
export interface LineupChar { name: string; file: string; scale: number; minY: number; }
// All on the Mixamo skeleton → one animation set drives every character (the single system).
export const LINEUP_CHARS: LineupChar[] = [
  { name: 'Ash',   file: '/siege/characters/pilot_ash.glb',   scale: 1.122, minY: -0.0055 },
  { name: 'Thorn', file: '/siege/characters/pilot_thorn.glb', scale: 0.697, minY: -0.2455 },
];

export interface LineupAnchor { x: number; z: number; yaw: number; groundY: number }

let enabled = false;
let animIndex = 0;
let animNames: string[] = [];
let anchor: LineupAnchor | null = null;
let version = 0; // monotonic — getSnapshot returns this so React never misses a change
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };

export const getCharLineupEnabled = (): boolean => enabled;

export function toggleCharLineup(): void { enabled = !enabled; emit(); }
export function setCharAnchor(a: LineupAnchor): void { anchor = a; emit(); }
export function setCharAnimNames(n: string[]): void { if (n.length && n.length !== animNames.length) { animNames = n; emit(); } }
export function cycleCharAnim(dir: number): void {
  if (!animNames.length) return;
  animIndex = (animIndex + dir + animNames.length) % animNames.length; emit();
}

export function useCharLineup(): { enabled: boolean; animIndex: number; animNames: string[]; anchor: LineupAnchor | null } {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => version, () => version);
  return { enabled, animIndex, animNames, anchor };
}
