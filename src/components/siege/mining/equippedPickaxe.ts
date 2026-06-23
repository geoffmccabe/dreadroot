// The currently-equipped PICKAXE — a two-handed mining TOOL (not a gun). Pickaxes already exist
// as items (each with its own ID); we recognise one by name/key ("…Pickaxe") and its mining
// power is the item's tier. EquipSlots publishes this whenever the left hand holds a pickaxe so
// the mining interaction (raycast + hold-to-mine, slice 3) knows the player can mine, and at what
// tier. null = no pickaxe equipped. Kept tiny + framework-free, mirroring flameGlove/rocketBelt.
import { useSyncExternalStore } from 'react';

export interface EquippedPickaxe { tier: number; name: string; }

// A pickaxe is any item whose name/key contains "pickaxe" (or "pick axe"). The existing pickaxe
// items are named that way; this stays ID-agnostic so new pickaxes work with no code change.
const PICKAXE_RE = /pick\s*-?\s*axe/i;
export const isPickaxe = (s?: string | null): boolean => !!s && PICKAXE_RE.test(s);

let pickaxe: EquippedPickaxe | null = null;
const subs = new Set<() => void>();

export function getEquippedPickaxe(): EquippedPickaxe | null { return pickaxe; }

export function setEquippedPickaxe(p: EquippedPickaxe | null): void {
  if (p === pickaxe) return;
  if (p && pickaxe && p.tier === pickaxe.tier && p.name === pickaxe.name) return;
  pickaxe = p;
  subs.forEach((f) => f());
}

export function useEquippedPickaxe(): EquippedPickaxe | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getEquippedPickaxe,
    getEquippedPickaxe,
  );
}
