// siegeInitLoad — bridges Siege Worlds' canvas-side world load to the World-Initialization overlay.
//
// The lobby's terrain + objects + textures only mount AFTER the player clicks START (the game scene
// is gated behind it). But the init orchestrator runs and finishes BEFORE START (it skips all the
// Dreadroot voxel work), so for SWW the overlay said "Ready to Play" while the lobby was still
// streaming in. The orchestrator ARMS this; the lobby loaders (TerrainLayer, WorldObjectsLayer,
// SiegeAssetProgress) log their REAL steps with timings; SiegeWorldLayers calls completeSiegeWorldLoad
// once terrain + every model/texture has actually loaded.
//
// Completion is gated on real readiness, NOT a fixed timer (the old 30s timer fired mid-load, falsely
// said "ready", then the world kept streaming). Instead an INACTIVITY watchdog finishes only if
// nothing has loaded for a while — so a long-but-progressing load is never cut off.
import { initLogStartStep, initLogFinishStep, initLogStep, initLogFinish } from '@/contexts/InitializationContext';

let armed = false;     // SWW startup has handed overlay completion to the canvas
let done = false;      // already completed (one-shot)
let watchdog: ReturnType<typeof setTimeout> | null = null;
const readySubs = new Set<() => void>();   // fired once when the lobby finishes loading (spawn-intro hook)

/** Subscribe to the one-shot "open world is loaded + on screen" moment (the genuine initial spawn,
 *  NOT a Cmd-J dev jump, which never re-arms the load). Returns an unsubscribe. */
export function onSiegeLobbyReady(cb: () => void): () => void { readySubs.add(cb); return () => { readySubs.delete(cb); }; }
const STALL_MS = 20000;   // finish only if NOTHING new loads for this long (a true stall, not slowness)

function kickWatchdog() {
  if (done) return;
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => completeSiegeWorldLoad('(no activity — finishing)'), STALL_MS);
}

/** SWW orchestrator: defer overlay completion to the canvas loaders (instead of finishing now). */
export function armSiegeWorldLoad() {
  armed = true; done = false;
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
}

export function isSiegeLoadActive() { return armed && !done; }

/** Begin a logged load phase (returns a step id, or null when not driving a SWW startup). Every
 *  logged phase resets the inactivity watchdog, so an actively-progressing load never times out. */
export function siegeLoadStart(file: string, message: string): string | null {
  if (!isSiegeLoadActive()) return null;
  kickWatchdog();
  return initLogStartStep(file, message);
}
export function siegeLoadFinish(id: string | null, count?: number) {
  if (isSiegeLoadActive() && id) { initLogFinishStep(id, count); kickWatchdog(); }
}
export function siegeLoadNote(file: string, message: string, count?: number) {
  if (isSiegeLoadActive()) { initLogStep(file, message, count); kickWatchdog(); }
}

/** Lobby is ready (terrain + every asset loaded) → finish the overlay. One-shot; safe to call often. */
export function completeSiegeWorldLoad(note = '') {
  if (!armed || done) return;
  done = true; armed = false;
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  initLogStep('SiegeWorld', `Lobby ready${note ? ' ' + note : ''}`);
  initLogFinish();
  readySubs.forEach((f) => { try { f(); } catch { /* a listener throwing must not break load completion */ } });
}
