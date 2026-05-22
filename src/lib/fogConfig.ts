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
 * Density for THREE.FogExp2. Tuned for a thick fog with a steep falloff —
 * roughly visibility 100% / 66% / 19% / 3% / 0% at chunk distances 0..4.
 * Render-edge (chunk 4) is effectively 0%, so the chunk cutoff is invisible.
 * Phase 2 (custom fog shader) will let us match an arbitrary visibility
 * curve exactly; this is the closest stock-fog approximation.
 */
export const FOG_DENSITY = 0.04;
