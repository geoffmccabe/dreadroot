// chestState — drives the Magic Chest open sequence (lid animation + reel reveal). The HUD panel
// starts it after the server RPC returns the reel + prize; the in-canvas chest reads the phase to
// open/close its lid.
import { useSyncExternalStore } from 'react';

export type ChestPhase = 'idle' | 'spinning' | 'revealed';
let phase: ChestPhase = 'idle';
let reel: number[] = [];
let prize = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getChestPhase = (): ChestPhase => phase;
export const getChestReel = (): number[] => reel;
export const getChestPrize = (): number => prize;
export function startChest(r: number[], pz: number): void { reel = r; prize = pz; phase = 'spinning'; emit(); }
export function revealChest(): void { phase = 'revealed'; emit(); }
export function closeChest(): void { phase = 'idle'; reel = []; prize = 0; emit(); }

export function useChestPhase(): ChestPhase {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getChestPhase, getChestPhase);
}
