// Runtime active-MAP switch (within a game). A "map" is a WorldDefinition in the
// SIEGE_WORLDS registry — Bleakrock (the real SW terrain), Starblink (a flat 10×
// canvas), and, later, an unlimited number of player-made named maps loaded from a
// table. activeGame picks DreadRoot vs Siege; activeMap picks WHICH siege world is
// rendered. Mirrors activeGame.ts: persisted, live-swap (no reload). FortressScene
// reads it, resolves the WorldDefinition, swaps SiegeWorldLayers + teleports the
// player to that map's spawn.
import { useSyncExternalStore } from 'react';

const KEY = 'activeMap';
let active: string =
  (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'siege-test';

const subs = new Set<() => void>();

export function getActiveMapId(): string {
  return active;
}

export function setActiveMapId(id: string): void {
  if (id === active) return;
  active = id;
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useActiveMapId(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveMapId,
    getActiveMapId,
  );
}
