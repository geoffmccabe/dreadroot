// Tiny module store for the block-chop visual pulse. FortressControls calls
// triggerChop() on each axe hit; the in-Canvas <ChopFeedback> reads the latest
// pulse each frame and renders a brief rainbow-edge flash + inward shrink.
// No React state — read directly in the frame loop to stay allocation-free.

interface ChopPulse {
  x: number; // block min-corner coords
  y: number;
  z: number;
  t: number; // performance.now() of the hit
}

let latest: ChopPulse = { x: 0, y: 0, z: 0, t: -1e9 };

/** Fire a chop pulse at the given block (min-corner coords). */
export function triggerChop(x: number, y: number, z: number): void {
  latest = { x, y, z, t: (typeof performance !== 'undefined' ? performance.now() : 0) };
}

export function getChopPulse(): ChopPulse {
  return latest;
}
