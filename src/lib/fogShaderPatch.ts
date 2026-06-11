/**
 * Override THREE's FogExp2 falloff so visibility decays linearly in distance
 * (i.e. visibility = exp(-density · d)) instead of exp(-density² · d²).
 *
 * That makes the curve geometric per chunk — pick density = -ln(r)/CHUNK_SIZE
 * to multiply visibility by `r` each chunk. See FOG_DENSITY in fogConfig.ts.
 *
 * Importing this module is enough — the patch runs once at module load,
 * before any material's shader is compiled, and applies to every material
 * that uses the standard fog chunks.
 */
import * as THREE from 'three';

// Non-linear distance fog: visibility = exp(-density·d), then the fog FACTOR is raised
// to a power so it stays clear up close and only thickens farther out (linear-exp alone
// fogs "too thick too quickly" near the camera). Higher power = clearer near.
const FOG_POWER = '2.6';
const original = THREE.ShaderChunk.fog_fragment;
const patched = original.replace(
  '1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )',
  `pow( 1.0 - exp( - fogDensity * vFogDepth ), ${FOG_POWER} )`,
);
if (patched === original) {
  console.warn('[fogShaderPatch] did not find the FogExp2 falloff expression — Three.js version may have changed it.');
} else {
  THREE.ShaderChunk.fog_fragment = patched;
}
