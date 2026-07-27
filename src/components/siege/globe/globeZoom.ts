// globeZoom — scroll-wheel zoom on the Mini Earth.
//
// Geoff, correctly annoyed: "I thought scroll-wheel would zoom in and out like it does in SWW but
// it doesn't work... that was core functionality and you must have actively removed it."
//
// For the record it was never removed — the globe is a new map with its own camera
// (GlobeCamera/KaijuWalkController) and the wheel was simply never wired to it, so it behaved as
// missing. Same outcome from where he is sitting, so: wired now.
//
// SWW binds Alt+wheel to third-person pull-back and leaves the plain wheel to weapon switching.
// Here the plain wheel zooms, because on a planet that is the far more useful thing and there is
// no weapon wheel on this map, and Alt+wheel does the same so the SWW muscle memory also works.
//
// One knob, used two ways, because "zoom" means different things in the two modes:
//   WALKING  pull the chase camera in toward the Kaiju, or push it out for a wider view
//   FLYING   change how fast altitude changes, so the wheel gets you to orbit and back quickly

/** Chase-camera distance multiplier while walking. 1 = the tuned default. */
let walkZoom = 1;
/** Range: shoulder-height right up close, out to a wide establishing shot of the Kaiju. */
const WALK_MIN = 0.35;
const WALK_MAX = 6;

/** Metres of altitude the wheel moves per notch while flying, as a fraction of current altitude. */
const FLY_STEP = 0.18;

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export function subscribeGlobeZoom(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getWalkZoom(): number { return walkZoom; }

/**
 * One wheel notch. Positive `delta` (wheel down) pulls the camera back, matching SWW and matching
 * every map application anyone has used.
 */
export function nudgeWalkZoom(delta: number): void {
  // Multiplicative, so a notch feels the same at every distance rather than crawling when close
  // and leaping when far.
  const factor = Math.exp(delta * 0.0016);
  const next = Math.min(WALK_MAX, Math.max(WALK_MIN, walkZoom * factor));
  if (next === walkZoom) return;
  walkZoom = next;
  emit();
}

export function resetWalkZoom(): void {
  if (walkZoom === 1) return;
  walkZoom = 1;
  emit();
}

/**
 * Altitude change for one wheel notch while flying, given the current altitude above ground.
 *
 * Proportional to altitude, so the wheel takes you from orbit to the ground in a sane number of
 * notches instead of the hundreds a fixed step would need across a range of 160,000 units.
 */
export function flyZoomDelta(delta: number, altitudeUnits: number): number {
  const step = Math.max(0.5, Math.abs(altitudeUnits)) * FLY_STEP;
  return Math.sign(delta) * step;
}
