// Reusable "glow" helper for the game's bloom (FortressPostFX). The global Bloom only
// blooms pixels brighter than its luminance threshold, so to make ANYTHING glow you
// push a bright, unclamped (toneMapped:false) emissive on its material. Use this one
// helper everywhere — monster eyes/cores, weapon edges, a flashlight cone, glowing
// plants, fortress lights — so glow looks consistent and tunable from one place.
//
//   const mat = new THREE.MeshStandardMaterial({ map });
//   applyGlow(mat, '#ff5a1f', 2.4);   // emissive that crosses the bloom threshold
//
// emissiveMap is honored — pass a frame/border map for an edge-only glow (e.g. niches).
import * as THREE from 'three';

export interface GlowOptions {
  color?: THREE.ColorRepresentation;
  /** ~1 = subtle, 2–3 = strong, 4+ = blazing. Drives emissiveIntensity. */
  intensity?: number;
  /** Optional emissive mask (e.g. an edges-only frame) so only part of the face glows. */
  emissiveMap?: THREE.Texture | null;
}

type GlowMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;

/** Make a material bloom. Returns the same material for chaining. */
export function applyGlow<T extends GlowMaterial>(mat: T, opts: GlowOptions = {}): T {
  const { color = '#ffffff', intensity = 2, emissiveMap = null } = opts;
  mat.emissive = new THREE.Color(color);
  mat.emissiveIntensity = intensity;
  if (emissiveMap) mat.emissiveMap = emissiveMap;
  // Keep the emissive in HDR (unclamped) so it exceeds the global bloom threshold.
  mat.toneMapped = false;
  mat.needsUpdate = true;
  return mat;
}

/** Animate a glow's intensity for a gentle torch/pulse flicker (call each frame with
 *  elapsed seconds). Kept moderate so it never blows out bloom/exposure into flashing. */
export function flickerGlow(mat: GlowMaterial, base: number, elapsed: number, amount = 0.15, speed = 9): void {
  const f = 1 - amount + amount * Math.sin(elapsed * speed) * Math.sin(elapsed * speed * 0.6 + 1.7);
  mat.emissiveIntensity = base * f;
}
