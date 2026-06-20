// A reusable LIGHT definition. Authored in the Effects > Lights panel, saved to the
// shared effect_definitions table (family 'lights') under a short reusable CODE, then
// referenced anywhere in the game (by the build LLM or by hand) to attach this exact
// light to a monster/object. First type: 'spotlight' (robot face/chest beam).

export type LightTypeId = 'spotlight' | 'glow';
export type PulseStyle = 'none' | 'sine' | 'heartbeat' | 'throb';

export interface LightDef {
  code: string;   // reusable handle, e.g. 'shombie-face'
  name: string;   // display name
  type: LightTypeId;

  // Beam
  color: string;
  intensity: number;   // kept modest (not blazing)
  angleDeg: number;    // full cone angle (22 = narrow)
  range: number;       // falloff to ~0 at this many metres (24 = one chunk)
  penumbra: number;    // 0..1 soft cone edge
  decay: number;       // physical falloff (2 = 1/r²)

  // Dark-rim circle (projected cookie)
  rimDarkness: number; // 0..1 — how dark the outer ring is
  rimSoftness: number; // 0..1 — edge softness

  // Visible beam in the fog (cheap additive cone)
  fogOn: boolean;
  fogColor: string;
  fogStrength: number; // 0..1 additive brightness
  fogLength: number;   // metres along the beam (≤ range)

  // Shadows (real but low-res / cheap; capped to nearest few at deploy time)
  shadowOn: boolean;
  shadowSize: number;  // 256 | 512 | 1024

  // The glowing emitter disc (the face circle itself)
  emitterOn: boolean;
  emitterColor: string;
  emitterIntensity: number;
  emitterSize: number; // diameter, metres

  // Liveliness — applies to BOTH types (drives the light's intensity over time).
  flicker: number;     // 0..1 random flicker amount
  flickerSpeed: number; // flicker rate
  pulseStyle: PulseStyle;
  pulseSpeed: number;  // pulse rate
  pulseDepth: number;  // 0..1 how deep the pulse dips

  // 'glow' type (omni point light like a Glow Block, washes nearby terrain):
  glowDecay: number;   // point-light decay (2 = physical 1/r²)

  // Mount (offset from the host, and aim pitch)
  offX: number;
  offY: number;
  offZ: number;
  pitchDeg: number;    // + tilts the beam down toward the ground
}

export const DEFAULT_LIGHT: LightDef = {
  code: 'new-light',
  name: 'New Light',
  type: 'spotlight',
  color: '#fff3d6',
  intensity: 1.4,
  angleDeg: 22,
  range: 24,
  penumbra: 0.5,
  decay: 1.6,
  rimDarkness: 0.7,
  rimSoftness: 0.35,
  fogOn: true,
  fogColor: '#fff3d6',
  fogStrength: 0.25,
  fogLength: 18,
  shadowOn: true,
  shadowSize: 512,
  emitterOn: true,
  emitterColor: '#fff3d6',
  emitterIntensity: 2.2,
  emitterSize: 0.7,
  flicker: 0.12,
  flickerSpeed: 9,
  pulseStyle: 'none',
  pulseSpeed: 2,
  pulseDepth: 0.5,
  glowDecay: 2,
  offX: 0,
  offY: 0,
  offZ: 0,
  pitchDeg: 8,
};

// Intensity multiplier over time from pulse + flicker (shared by both light types).
export function lightWave(def: LightDef, t: number): number {
  let p = 1;
  const sp = def.pulseSpeed, d = def.pulseDepth;
  if (def.pulseStyle === 'sine') {
    p = 1 - d + d * (0.5 + 0.5 * Math.sin(t * sp));
  } else if (def.pulseStyle === 'throb') {
    const s = 0.5 + 0.5 * Math.sin(t * sp);
    p = 1 - d + d * s * s; // sharper swell
  } else if (def.pulseStyle === 'heartbeat') {
    const ph = (t * sp * 0.25) % 1; // two quick beats then rest
    const beat = Math.exp(-Math.pow((ph - 0.08) * 9, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.26) * 9, 2));
    p = 1 - d + d * Math.min(1, beat);
  }
  let f = 1;
  if (def.flicker > 0) {
    const s = t * def.flickerSpeed;
    f = 1 - def.flicker + def.flicker * Math.sin(s) * Math.sin(s * 0.6 + 1.7);
  }
  return Math.max(0, p * f);
}

/** name -> reusable code (lowercase kebab, safe for the DB `code` column). */
export function slugifyCode(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'light';
}
