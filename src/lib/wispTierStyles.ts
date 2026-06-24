/**
 * Wisp tier visual styles (data-driven, shared).
 *
 * One style per wisp tier (1-10), driving both the floating wisp entity
 * (WispBlock) and — later — the placed wisp blocks. Keeping it as plain data
 * means the look of every tier lives in ONE place and the renderers stay dumb.
 *
 * `effect` selects the per-frame animation a renderer applies on top of the
 * base material (color / emissive / metalness / opacity).
 */

export type WispEffect =
  | 'matte'      // dull, opaque-ish, no glow (T1)
  | 'glass'      // colored translucent, gentle glow pulse
  | 'electric'   // base glow + random crackle spikes
  | 'flames'     // emissive flickers through fire colors
  | 'metallic'   // PBR metal (gold/silver), shimmer
  | 'radiant'    // strong steady glow (heavenly)
  | 'rainbow';   // hue cycles across the spectrum

export interface WispTierStyle {
  tier: number;
  name: string;
  color: string;            // base diffuse
  emissive: string;         // emissive tint (fire/electric colors override per-frame)
  emissiveIntensity: number;// baseline glow
  metalness: number;
  roughness: number;
  opacity: number;          // <1 => transparent
}

export const WISP_TIER_STYLES: Record<number, { style: WispTierStyle; effect: WispEffect }> = {
  1:  { effect: 'matte',    style: { tier: 1,  name: 'Common',      color: '#9C7A4F', emissive: '#000000', emissiveIntensity: 0.0, metalness: 0.0, roughness: 0.95, opacity: 0.85 } },
  2:  { effect: 'glass',    style: { tier: 2,  name: 'Uncommon',    color: '#3FA34D', emissive: '#2EC4B6', emissiveIntensity: 0.35, metalness: 0.0, roughness: 0.55, opacity: 0.6 } },
  3:  { effect: 'electric', style: { tier: 3,  name: 'Rare',        color: '#2E86DE', emissive: '#7FD4FF', emissiveIntensity: 0.5,  metalness: 0.1, roughness: 0.3,  opacity: 0.55 } },
  4:  { effect: 'electric', style: { tier: 4,  name: 'Epic',        color: '#8E44AD', emissive: '#D17BFF', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.2,  opacity: 0.55 } },
  5:  { effect: 'flames',   style: { tier: 5,  name: 'Legendary',   color: '#E63946', emissive: '#FF7A00', emissiveIntensity: 0.7,  metalness: 0.0, roughness: 0.5,  opacity: 0.6 } },
  6:  { effect: 'radiant',  style: { tier: 6,  name: 'Divine',      color: '#F5F5FA', emissive: '#FFF2C0', emissiveIntensity: 0.9,  metalness: 0.2, roughness: 0.4,  opacity: 0.65 } },
  7:  { effect: 'metallic', style: { tier: 7,  name: 'Mystic',      color: '#D9D9E0', emissive: '#FF6FB5', emissiveIntensity: 0.6,  metalness: 0.95, roughness: 0.25, opacity: 0.75 } },
  8:  { effect: 'rainbow',  style: { tier: 8,  name: 'Rainbow',     color: '#FF4D4D', emissive: '#FF4D4D', emissiveIntensity: 0.75, metalness: 0.1, roughness: 0.35, opacity: 0.6 } },
  9:  { effect: 'flames',   style: { tier: 9,  name: 'Apocalyptic', color: '#1A1A1A', emissive: '#FF3300', emissiveIntensity: 0.85, metalness: 0.0, roughness: 0.6,  opacity: 0.7 } },
  10: { effect: 'metallic', style: { tier: 10, name: 'Cosmic',      color: '#FFD700', emissive: '#FFC107', emissiveIntensity: 0.8,  metalness: 1.0, roughness: 0.2,  opacity: 0.85 } },
};

// Tier read off a block_type / key like 'wisp_4' or a numeric tier field.
export function wispStyleFor(tier: number | undefined | null) {
  const t = Math.max(1, Math.min(10, tier ?? 1));
  return WISP_TIER_STYLES[t] ?? WISP_TIER_STYLES[1];
}

// Fire palette shared by the 'flames' effect (legendary + apocalyptic).
export const WISP_FIRE_COLORS = ['#FF2200', '#FF6A00', '#FFB000', '#FFE000'];
