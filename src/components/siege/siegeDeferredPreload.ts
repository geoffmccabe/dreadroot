// siegeDeferredPreload — warm the heavy assets the IMMEDIATE lobby view does NOT need (every monster
// glb, the dev character-lineup meshes + guns) AFTER the lobby is on screen, on idle — instead of at
// module import.
//
// Why: those preloads used to fire at module-import (app boot), so they were downloading/decoding
// during the lobby's own asset crunch, fighting it for the browser's ~6 connections-per-host and
// adding ~25 glbs to the critical path. None of them are visible on spawn (monsters spawn on-demand;
// the lineup is a '&&&' dev overlay). Now the lobby loads first, and these warm a beat later so a
// later challenge wave / lineup toggle still never decodes cold.
import { onSiegeLobbyReady } from './siegeInitLoad';

const ric = (cb: () => void) => {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(cb, { timeout: 2000 });
  else setTimeout(cb, 1);
};

const queue: Array<() => void> = [];
let armed = false;
let fired = false;

function drain() {
  if (fired) return;
  fired = true;
  // Let the freshly-loaded lobby settle before we start pulling heavy glbs, then run one per idle
  // slice so a batch of decodes never bunches into a single frame and hitches the spawn.
  setTimeout(() => {
    let i = 0;
    const pump = () => {
      if (i >= queue.length) return;
      try { queue[i++](); } catch { /* a failed warm-up must never break anything */ }
      ric(pump);
    };
    pump();
  }, 1500);
}

/** Register a preload to run once, on idle, after the lobby first finishes loading. */
export function deferLobbyPreload(fn: () => void) {
  queue.push(fn);
  if (!armed) { armed = true; onSiegeLobbyReady(drain); }
}
