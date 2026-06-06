/**
 * Strip Animation Material (v4.12.15)
 *
 * Animates a horizontal sprite-strip WebP (N square frames laid out
 * left-to-right, produced by animationToStrip.ts) entirely on the GPU
 * via a shader UV offset. There is ZERO per-tick CPU or GPU decode work:
 *
 *   - The strip is uploaded to the GPU once as a normal static texture.
 *   - A single module-level clock uniform is advanced once per frame.
 *   - Each material's fragment shader computes the current frame with
 *     `mod(floor(time / delay), frames)` and samples that horizontal
 *     slice of the strip.
 *
 * Because the clock is one shared uniform object, EVERY strip material in
 * the scene animates from a single per-frame write — no per-instance
 * attribute rewrites, no texture re-uploads. This is the opposite of the
 * old useAnimatedTexture path (which decoded GIF frames and re-uploaded a
 * canvas every tick) and of the per-instance atlas-attribute approach
 * (which re-uploads instance buffers every tick).
 *
 * Usage:
 *   const strip = parseStripMetadata(url);            // { frames, delay } | null
 *   if (strip) applyStripAnimation(material, strip.frames, strip.delay);
 *
 * Gated on parseStripMetadata being non-null, so static textures and any
 * legacy non-migrated .gif rows keep their existing path untouched.
 */

import * as THREE from 'three';
import { frameLoop } from './frameLoop';

// Half-texel inset (frames are 256px square) to stop bilinear filtering
// from bleeding across the boundary between adjacent horizontal frames.
const HALF_TEXEL = 0.5 / 256;

// One shared clock, in milliseconds, read by every strip material. THREE
// reads `.value` off this exact object each frame, so a single write here
// updates all strip materials at once.
const sharedStripClock = { value: 0 };

let clockRegistered = false;
function ensureClockRegistered(): void {
  if (clockRegistered) return;
  clockRegistered = true;
  // Priority is irrelevant (consumers read the uniform on the GPU at draw
  // time, not on the CPU), but run early so the value is fresh.
  frameLoop.register(
    'strip-anim-clock',
    (_delta, elapsed) => {
      sharedStripClock.value = elapsed * 1000;
    },
    1,
  );
}

/**
 * Patch a material so its `map` is treated as a horizontal sprite strip
 * and animated on the GPU. Works for any standard mesh material whose
 * fragment shader includes the <map_fragment> chunk (Basic, Lambert,
 * Standard, Physical). `frames` and `delayMs` are baked as GLSL constants
 * (they are fixed per material); only the clock varies at runtime.
 *
 * Safe to call on an already-created material; sets needsUpdate so the
 * program recompiles with the injected code.
 */
export function applyStripAnimation(
  material: THREE.Material,
  frames: number,
  delayMs: number,
): void {
  if (frames <= 1) return; // single-frame strip = static; nothing to animate
  ensureClockRegistered();

  const framesF = frames.toFixed(1);
  const delayF = Math.max(delayMs, 1).toFixed(1);
  const halfTexel = HALF_TEXEL.toFixed(6);

  material.onBeforeCompile = (shader) => {
    // Share the one clock object across every strip material.
    shader.uniforms.uStripTime = sharedStripClock;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uStripTime;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        float _stripFrame = mod(floor(uStripTime / ${delayF}), ${framesF});
        float _stripU = clamp(fract(vMapUv.x), ${halfTexel}, ${(1 - HALF_TEXEL).toFixed(6)});
        vec2 _stripUv = vec2((_stripU + _stripFrame) / ${framesF}, vMapUv.y);
        vec4 sampledDiffuseColor = texture2D(map, _stripUv);
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  };

  material.needsUpdate = true;
}

/**
 * Also animate the emissive map (for glowing blocks / seeds). Call AFTER
 * applyStripAnimation when the same strip drives both map and emissiveMap.
 * Patches <emissivemap_fragment> in addition to <map_fragment>.
 */
export function applyStripAnimationEmissive(
  material: THREE.Material,
  frames: number,
  delayMs: number,
): void {
  if (frames <= 1) return;
  ensureClockRegistered();

  const framesF = frames.toFixed(1);
  const delayF = Math.max(delayMs, 1).toFixed(1);
  const halfTexel = HALF_TEXEL.toFixed(6);

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    // Run the diffuse-map patch first (if applyStripAnimation set one).
    if (prev) prev(shader, renderer as any);

    if (!shader.uniforms.uStripTime) {
      shader.uniforms.uStripTime = sharedStripClock;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uStripTime;`,
      );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#ifdef USE_EMISSIVEMAP
        float _eStripFrame = mod(floor(uStripTime / ${delayF}), ${framesF});
        float _eStripU = clamp(fract(vEmissiveMapUv.x), ${halfTexel}, ${(1 - HALF_TEXEL).toFixed(6)});
        vec2 _eStripUv = vec2((_eStripU + _eStripFrame) / ${framesF}, vEmissiveMapUv.y);
        vec4 emissiveColor = texture2D(emissiveMap, _eStripUv);
        totalEmissiveRadiance *= emissiveColor.rgb;
      #endif`,
    );
  };

  material.needsUpdate = true;
}
