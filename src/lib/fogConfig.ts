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
// Linear-exp fog (patched, see fogShaderPatch.ts): visibility = exp(-density·dist).
// Pick density so visibility is VIS_AT_BOUNDARY at the full-detail render edge.
const CHUNK_SIZE = 16;
const VIS_AT_BOUNDARY = 0.04;
export const FOG_DENSITY = -Math.log(VIS_AT_BOUNDARY) / (FOG_DISTANCE_CHUNKS * CHUNK_SIZE); // ≈0.0503

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

export function updateFogForHeight(_y: number): void {
  // Height-CONSISTENT: no altitude thinning — the old ×0.25 thinning made distant
  // chunks stay ~50% visible when flying. Same fade at any height.
  fogState.density = FOG_DENSITY;
  fogState.distChunks = FOG_DISTANCE_CHUNKS;
}
