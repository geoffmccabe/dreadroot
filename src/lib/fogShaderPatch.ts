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

const original = THREE.ShaderChunk.fog_fragment;
const patched = original.replace(
  'fogDensity * fogDensity * vFogDepth * vFogDepth',
  'fogDensity * vFogDepth',
);
if (patched === original) {
  console.warn('[fogShaderPatch] did not find the FogExp2 falloff expression — Three.js version may have changed it.');
} else {
  THREE.ShaderChunk.fog_fragment = patched;
}
