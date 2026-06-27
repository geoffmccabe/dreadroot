// FireflySpecies — the data model for a "species" of firefly (one card in the world-builder
// Firefly panel). Everything the panel exposes lives here; the renderer (EnchantedFireflies)
// turns a list of species into GPU points. Defaults are the randomized "standard" look Geoff
// specced. A world's ambience = an array of species (like the Challenge Creator's wave cards).
import { create } from 'zustand';

export interface FireflySpecies {
  id: string;
  name: string;
  enabled: boolean;
  // ── density / size ───────────────────────────────────────────────
  count: number;          // how many of this species
  size: number;           // base point size (px at 1 unit); per-point varies ±20%
  // ── colour ───────────────────────────────────────────────────────
  baseColor: string;      // the standard hue (hex)
  towardFuchsia: number;  // 0..1 — how far each point may drift from base toward fuchsia
  towardBlue: number;     // 0..1 — …or toward blue (each point picks one direction, random amount)
  randomColorPct: number; // 0..1 — fraction with a TOTALLY random hue (green/yellow/anything)
  // ── motion ───────────────────────────────────────────────────────
  speed: number;          // base drift speed
  speedVariancePct: number; // 0.5 = each point is ±50% of base speed
  driftRadius: number;    // horizontal wander amplitude (m)
  sineWavePct: number;    // 0..1 — fraction with an extra erratic sine wobble
  // ── high-flyers (a sub-population that acts like a different species) ──
  highFlyerPct: number;   // 0..1 — fraction that hover high + erratic Y
  highFlyerSpeedMul: number; // their speed multiplier (×3 default)
  highFlyerYBoost: number;   // extra Y range (m) they roam into the trees
  // ── light pulse / blink ──────────────────────────────────────────
  pulseOnFracMin: number; // 0.1 = lit only 10% of its cycle (blinking) … 1 = always on
  pulseOnFracMax: number;
  fadeMinSec: number;     // 0 = snaps on/off instantly
  fadeMaxSec: number;     // 2 = very slow fade in/out
  // ── area ─────────────────────────────────────────────────────────
  area: number;           // horizontal half-extent of the swarm (m), centred on origin
  yMin: number;
  yMax: number;
}

let _n = 0;
export const newSpeciesId = () => `ff${Date.now().toString(36)}_${_n++}`;

/** The standard randomized species (Geoff's spec). */
export function defaultSpecies(over: Partial<FireflySpecies> = {}): FireflySpecies {
  return {
    id: newSpeciesId(),
    name: 'Wisp',
    enabled: true,
    count: 80,
    size: 1.1,
    baseColor: '#b9a3ff',  // soft purple
    towardFuchsia: 0.5,
    towardBlue: 0.5,
    randomColorPct: 0.1,
    speed: 0.5,
    speedVariancePct: 0.5,
    driftRadius: 1.4,
    sineWavePct: 0.1,
    highFlyerPct: 0.1,
    highFlyerSpeedMul: 3,
    highFlyerYBoost: 14,
    pulseOnFracMin: 0.1,
    pulseOnFracMax: 1.0,
    fadeMinSec: 0,
    fadeMaxSec: 2,
    area: 130,
    yMin: 0.5,
    yMax: 22,
    ...over,
  };
}

// ── store (drives the live renderer + the panel) ───────────────────
interface FireflyState {
  species: FireflySpecies[];
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  addSpecies: () => void;
  removeSpecies: (id: string) => void;
  updateSpecies: (id: string, patch: Partial<FireflySpecies>) => void;
  setSpecies: (s: FireflySpecies[]) => void;
}

export const useFireflyStore = create<FireflyState>((set) => ({
  species: [defaultSpecies()],
  panelOpen: false,
  setPanelOpen: (b) => set({ panelOpen: b }),
  addSpecies: () => set((st) => ({ species: [...st.species, defaultSpecies({ name: `Species ${st.species.length + 1}` })] })),
  removeSpecies: (id) => set((st) => ({ species: st.species.filter((s) => s.id !== id) })),
  updateSpecies: (id, patch) => set((st) => ({ species: st.species.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
  setSpecies: (s) => set({ species: s }),
}));
