// Central tunables for the global "look" (tone mapping, bloom, IBL). Phase 1 of the
// render-mood system: one place to dial the cinematic pass so later phases (per-world
// mood presets, quality tiers, color grading) read from a single source of truth.
//
// Why these defaults:
//  * AgX tone mapping (not ACES) — handles bright emissives/sun without the hue shift
//    and oversaturation ACES pushes (reds→orange). Slightly flatter midtones, so we
//    nudge exposure up a touch to keep the scene from reading dark.
//  * Bloom is KERNEL-based (NOT mipmapBlur). mipmapBlur smears any single shader NaN
//    across the whole screen → the old full-screen black-flash-while-moving bug. A
//    fixed kernel keeps a bad pixel local, so a stray NaN can't nuke the frame.
//  * IBL is subtle — it only touches PBR materials (monsters, glass, emissive blocks);
//    Lambert world blocks ignore it. Kept low so it lifts form without washing color.

import { AgXToneMapping } from 'three';

export const LOOK = {
  toneMapping: AgXToneMapping,
  /** AgX middle-grey sits lower than ACES; ~1.1 keeps perceived brightness similar. */
  exposure: 1.1,

  bloom: {
    /** Only genuinely bright pixels (unclamped emissives > 1, sun glints) bloom. */
    luminanceThreshold: 0.9,
    /** Soft ramp across the threshold so pixels fade in/out of bloom (no popping). */
    luminanceSmoothing: 0.3,
    intensity: 0.7,
    /** Spread of the glow. Kernel blur (mipmapBlur OFF) → flash-proof. */
    radius: 0.7,
  },

  ibl: {
    /** Scene-wide image-based ambient. Subtle: form on PBR mats, not a colour wash. */
    intensity: 0.35,
  },
} as const;
