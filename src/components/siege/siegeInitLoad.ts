// siegeInitLoad — bridges Siege Worlds' canvas-side world load to the World-Initialization overlay.
//
// The lobby's terrain + objects + textures only mount AFTER the player clicks START (the game scene
// is gated behind it). But the init orchestrator runs and finishes BEFORE START (it skips all the
// Dreadroot voxel work), so for SWW the overlay said "Ready to Play" while the lobby was still
// streaming in — the player clicked onto an empty world.
//
// Fix: the orchestrator ARMS this instead of finishing; the lobby loaders (TerrainLayer,
// WorldObjectsLayer) log their REAL steps with timings; SiegeWorldLayers calls completeSiegeWorldLoad
// once terrain + objects are ready — so the overlay stays up, showing actual progress, until the
// lobby is genuinely on screen.
import { initLogStartStep, initLogFinishStep, initLogStep, initLogFinish } from '@/contexts/InitializationContext';

let armed = false;     // SWW startup has handed overlay completion to the canvas
let done = false;      // already completed (one-shot)
let started = false;   // the first canvas-side load step has begun (starts the safety timer)
let safety: ReturnType<typeof setTimeout> | null = null;

/** SWW orchestrator: defer overlay completion to the canvas loaders (instead of finishing now). */
export function armSiegeWorldLoad() {
  armed = true; done = false; started = false;
  if (safety) { clearTimeout(safety); safety = null; }
}

export function isSiegeLoadActive() { return armed && !done; }

/** Begin a logged load phase (returns a step id, or null when not driving a SWW startup). The
 *  safety timer starts on the FIRST real load step (i.e. once the canvas is actually loading,
 *  post-START — never while the player idles on the homescreen). */
export function siegeLoadStart(file: string, message: string): string | null {
  if (!isSiegeLoadActive()) return null;
  if (!started) {
    started = true;
    safety = setTimeout(() => completeSiegeWorldLoad('(timed out)'), 30000);
  }
  return initLogStartStep(file, message);
}
export function siegeLoadFinish(id: string | null, count?: number) {
  if (isSiegeLoadActive() && id) initLogFinishStep(id, count);
}
export function siegeLoadNote(file: string, message: string, count?: number) {
  if (isSiegeLoadActive()) initLogStep(file, message, count);
}

/** Lobby is ready (terrain + objects loaded) → finish the overlay. One-shot; safe to call often. */
export function completeSiegeWorldLoad(note = '') {
  if (!armed || done) return;
  done = true; armed = false;
  if (safety) { clearTimeout(safety); safety = null; }
  initLogStep('SiegeWorld', `Lobby ready${note ? ' ' + note : ''}`);
  initLogFinish();
}
