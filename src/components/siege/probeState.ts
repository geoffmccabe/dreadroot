// Shared laser-probe state: LaserProbe (in-canvas) writes it each frame; CoordsHud's
// C-copy reads it so the copied report includes what the laser is pointing at.
export const probeState = {
  on: false,
  hasHit: false,
  hit: null as string | null,      // "model / sub-mesh [instance N]"
  hx: 0, hy: 0, hz: 0,             // hit point (engine coords)
};
