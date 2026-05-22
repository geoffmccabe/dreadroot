/**
 * Fog / render-distance config — see docs/FOG_PLAN.md.
 *
 * FOG_DISTANCE_CHUNKS drives BOTH the fog (fully opaque at this distance) and
 * the chunk render radius — the same number on purpose, so we never render
 * chunks the fog has already hidden. That linkage is the rendering speedup.
 *
 * Phase 4 will make this admin-driven (Light / Medium / Heavy presets). For
 * now it is a single tuned value.
 */
export const FOG_DISTANCE_CHUNKS = 4;

/**
 * Density for FogExp2 *combined with the patched fog formula in
 * fogShaderPatch.ts* — visibility = exp(-density · d). Per-chunk
 * visibility ratio r = exp(-density · CHUNK_SIZE).
 *
 * Tuned so r ≈ 0.6: visibility multiplies by 0.6 each chunk.
 * Curve: 100% / 60% / 36% / 22% / 13% at chunk distances 0..4.
 */
export const FOG_DENSITY = 0.0319; // -ln(0.6) / 16

/**
 * Height-aware fog. As the player climbs, fog thins and the render radius
 * extends so you see further — at altitude there are few chunks anyway.
 *
 *   y ≤ 100  blocks: full fog,  render 4 chunks (the base curve).
 *   y = 150  blocks: half fog,  render 6 chunks.
 *   y ≥ 200  blocks: 25% fog,   render 10 chunks ("above the clouds").
 *
 * The fields in `fogState` are read live every frame by the fog effect
 * (density) and the chunk-visibility memo (distChunks).
 */
export const fogState = {
  density: FOG_DENSITY,
  distChunks: FOG_DISTANCE_CHUNKS,
};

export function updateFogForHeight(y: number): void {
  if (y <= 100) {
    fogState.density = FOG_DENSITY;
    fogState.distChunks = FOG_DISTANCE_CHUNKS;
    return;
  }
  if (y >= 200) {
    fogState.density = FOG_DENSITY * 0.25;
    fogState.distChunks = 10;
    return;
  }
  // Two piecewise-linear segments: 100→150 (full→half, 4→6 chunks) and
  // 150→200 (half→quarter, 6→10 chunks). Continuous at y=150.
  if (y < 150) {
    const t = (y - 100) / 50;
    fogState.density = FOG_DENSITY * (1 - 0.5 * t);
    fogState.distChunks = Math.round(4 + 2 * t);
  } else {
    const t = (y - 150) / 50;
    fogState.density = FOG_DENSITY * (0.5 - 0.25 * t);
    fogState.distChunks = Math.round(6 + 4 * t);
  }
}
