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

  /**
   * THE GRADE. Applied on the Mini Earth only, because it is tuned for one sun over open landscape.
   *
   * Geoff: "everything looks soft and washed out... give it a more cinematic style."
   *
   * Grading cannot create contrast that the LIGHTING did not produce — that is why the sun and the
   * flat-fill removal came first. What it does is take an image that now HAS a bright side and a
   * dark side and shape the response: pull the exposure down so highlights have somewhere to go,
   * add contrast so midtones separate, take a little saturation off (film is less saturated than
   * raw sRGB, and over-saturated greens are the giveaway of an ungraded game), and vignette so the
   * eye goes to the middle of the frame.
   */
  grade: {
    /** Below the 1.1 default: with a real key light the scene no longer needs lifting. */
    exposure: 0.92,
    /** Positive contrast on a scene that finally has a tonal range to work with. */
    contrast: 0.16,
    brightness: -0.015,
    /** Slightly desaturated. Cinema is not a screenshot. */
    saturation: -0.10,
    vignette: { offset: 0.28, darkness: 0.62 },
  },

  /**
   * AMBIENT OCCLUSION. The contact shadow a shadow map is too coarse to draw.
   *
   * A 3 km shadow map has texels about 1.5 m across, so where a Kaiju's foot meets the ground there
   * is nothing to darken the join and the creature reads as hovering. AO fills exactly that gap: it
   * darkens crevices and the ground immediately under and around anything sitting on it, which is
   * what "seats" an object into a scene. It also does most of the work on canyon geometry, because
   * a gorge is one enormous crevice.
   */
  ao: {
    intensity: 22,
    radius: 0.12,
    luminanceInfluence: 0.6,
    /** Cheap by AO standards. Anything higher is not worth it at this resolution. */
    samples: 16,
    rings: 4,
  },
} as const;
