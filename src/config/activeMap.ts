// Runtime active-MAP switch (within the Siege game). A "map" is a WorldDefinition in the
// SIEGE_WORLDS registry — the SWW open world ('siege-test', whose areas you teleport
// between by coords), Starblink (the builder sandbox), and later player-made maps. The
// map is INTRINSIC to the area you teleport to (SiegeTeleport sets it); there is no
// independent persisted "map chooser". So this does NOT persist — every session/game-
// entry starts in the SWW open world, and you reach Starblink via its teleport pad. That
// prevents getting stranded on the wrong map after a reload or DreadRoot↔SWW switch.
import { useSyncExternalStore } from 'react';

let active = 'siege-test';
const subs = new Set<() => void>();

export function getActiveMapId(): string {
  return active;
}

export function setActiveMapId(id: string): void {
  if (id === active) return;
  active = id;
  subs.forEach((f) => f());
}

export function useActiveMapId(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveMapId,
    getActiveMapId,
  );
}
