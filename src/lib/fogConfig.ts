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
