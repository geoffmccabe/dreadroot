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
export const FOG_DISTANCE_CHUNKS = 5;

/**
 * Far low-detail ring (Pinkland): how many EXTRA chunks beyond the full-detail
 * render distance to draw as cheap, textureless silhouettes (via FadeChunkBlocks)
 * so distant trees/terrain are visible early and fade in, instead of popping in
 * at the fog wall.
 *
 * ⏪ TO REVERT: set this to 0. Everything below derives from it, so 0 restores
 * the exact previous behavior (fog density, load radius, and the far ring all
 * collapse back to the original).
 */
export const EXTRA_VIEW_CHUNKS = 0;

/**
 * Density for FogExp2 *combined with the patched fog formula in
 * fogShaderPatch.ts* — visibility = exp(-density · d). Per-chunk
 * visibility ratio r = exp(-density · CHUNK_SIZE).
 *
 * Tuned so r ≈ 0.6: visibility multiplies by 0.6 each chunk.
 * Curve: 100% / 60% / 36% / 22% / 13% at chunk distances 0..4.
 */
// Fog is stretched so it reaches the same ~13% visibility at the FAR ring edge
// (FOG_DISTANCE_CHUNKS + EXTRA_VIEW_CHUNKS) instead of at FOG_DISTANCE_CHUNKS —
// otherwise the far ring would be hidden by fog. With EXTRA_VIEW_CHUNKS=0 this
// evaluates to exactly 0.0319 (-ln(0.6)/16), the original value.
// Linear-exp fog (patched — see fogShaderPatch.ts): visibility = exp(-density·dist).
// Pick density so visibility is exactly VIS_AT_BOUNDARY at the full-detail edge; the
// silhouette ring then continues the same curve to ~1.6% at the far edge.
const CHUNK_SIZE = 16;
// Lower = THICKER fog (distant objects hidden harder, so they emerge gradually as you
// approach instead of popping in at the render edge). Raised thickness 2026-Jul: the
// brighter AgX tone-mapping made the old 0.04 read as a thin haze. 0.012 ≈ +37% density.
const VIS_AT_BOUNDARY = 0.012;
export const FOG_DENSITY = -Math.log(VIS_AT_BOUNDARY) / (FOG_DISTANCE_CHUNKS * CHUNK_SIZE);

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
  // Height-CONSISTENT (approved): no altitude thinning — the old ×0.25 thinning is
  // what made distant chunks stay ~50% visible when flying. Same fade at any height.
  fogState.density = FOG_DENSITY;
  fogState.distChunks = FOG_DISTANCE_CHUNKS;
}
