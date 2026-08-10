// globeActive — is the Mini Earth map ACTUALLY on screen right now?
//
// Geoff: "you have fucked up the lighting on the entire game now! When I'm in SWU now the lighting
// is blown out on the characters."
//
// My fault, and this is the missing piece. The Mini Earth settings live in a PERSISTED store, so
// `enabled` stays true across maps and across sessions — that is what makes the panel useful. But
// LookComposer is global: it renders for every world. It was checking `enabled` alone, so the moment
// the Mini Earth panel was switched on, its grade — contrast up, saturation down, a vignette — was
// applied to Siege Worlds, the lobby, and everything else. Raised contrast is exactly what "blown
// out on the characters" looks like.
//
// "Is the feature enabled" and "are we on the map it belongs to" are two different questions, and I
// had only been asking the first. Anything scoped to one map must ask both.
//
// A module flag rather than a store: it is read during render by a component that must not
// re-subscribe, and it is owned by exactly one mounter (GlobeLighting).

/**
 * REACTIVE, and it has to be. As a plain module flag this was a real bug.
 *
 * LookComposer reads it during render to decide whether the grade belongs in the effect chain, and
 * a bare variable notifies nobody — so at start-up the composer rendered BEFORE the globe mounted,
 * saw false, and built a chain without the grade. Nothing ever told it to look again, so the grade
 * was missing until some unrelated re-render happened to rebuild the composer.
 *
 * That is exactly the difference between "the setting was already on when the app loaded" and "I
 * turned it on afterwards" — the second path re-renders and the first does not. Which is precisely
 * the difference Geoff hit: the same values, right by hand and wrong as a default.
 */
import { useSyncExternalStore } from 'react';

let active = false;
const listeners = new Set<() => void>();

export function setGlobeActive(v: boolean): void {
  if (active === v) return;
  active = v;
  listeners.forEach((l) => l());
}
export function isGlobeActive(): boolean { return active; }

export function useGlobeActive(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => active,
    () => false,
  );
}
