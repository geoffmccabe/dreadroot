// siegeCharLineupState — the toggleable character lineup (the 5 Starblind characters). Toggled
// with "&&&", appears on the ground in front of the player in any SWW world. M/N cycle the shared
// animation (same Mixamo skeleton + clips on every character, so one index drives all). Each
// animation has a 1-based number for reference.
import { useSyncExternalStore } from 'react';

export interface LineupChar { name: string; file: string; }
// All on the Mixamo skeleton → one animation set drives every character (the single system).
export const LINEUP_CHARS: LineupChar[] = [
  { name: 'Ash',   file: '/siege/characters/pilot_ash.glb' },
  { name: 'Thorn', file: '/siege/characters/pilot_thorn.glb' },
];

let enabled = false;
let animIndex = 0;
let animNames: string[] = [];
let anchor: { x: number; z: number; yaw: number } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getCharLineupEnabled = (): boolean => enabled;
export const getCharAnimIndex = (): number => animIndex;
export const getCharAnimNames = (): string[] => animNames;
export const getCharAnchor = () => anchor;

export function toggleCharLineup(): void { enabled = !enabled; emit(); }
export function setCharAnchor(a: { x: number; z: number; yaw: number }): void { anchor = a; emit(); }
export function setCharAnimNames(n: string[]): void { if (n.length && n.length !== animNames.length) { animNames = n; emit(); } }
export function cycleCharAnim(dir: number): void {
  if (!animNames.length) return;
  animIndex = (animIndex + dir + animNames.length) % animNames.length; emit();
}

const snap = () => (enabled ? 1 : 0) ^ (animIndex << 1) ^ (animNames.length << 10);
export function useCharLineup(): { enabled: boolean; animIndex: number; animNames: string[]; anchor: typeof anchor } {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, snap, snap);
  return { enabled, animIndex, animNames, anchor };
}
