// FireflySpecies — the data model for a "species" of firefly (one card in the world-builder
// Firefly panel, opened with "@FF"). Everything the panel exposes lives here; the renderer
// (EnchantedFireflies) turns a list of species into GPU points. Defaults are the randomized
// "standard" look Geoff specced. A world's ambience = an array of species (like the Challenge
// Creator's wave cards).
//
// Spawn codes:  "@FF" opens this panel.  "@F<code>" spawns one species by its GLOBAL code
// (starting at #1 for the built-ins). A player may only spawn their OWN species; admins and
// superadmins may spawn any.
import create from 'zustand';   // zustand v3 → default export (no named { create })

export interface FireflySpecies {
  id: string;
  code: number;           // GLOBAL spawn code → "@F<code>" (0 = not yet assigned)
  ownerId: string;        // who authored it ('' = built-in/system); gates "@F<code>" spawning
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
  // ── type mix (weights, not %) — the swarm splits between Regular and High-flyer sub-populations
  //    in proportion to these weights; the panel shows each one's share as a live xx.xx% ──
  regularWeight: number;     // relative weight of the ordinary drifters
  highFlyerWeight: number;   // relative weight of the high-flyers (hover high + erratic Y)
  highFlyerSpeedMul: number; // high-flyer speed multiplier (×3 default)
  highFlyerYBoost: number;   // extra Y range (m) high-flyers roam into the trees
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
    code: 0,
    ownerId: '',
    name: 'Wisp',
    enabled: true,
    count: 450,             // dense enough to read as a swarm; GPU points so cost is trivial
    size: 1.7,
    baseColor: '#b9a3ff',  // soft purple
    towardFuchsia: 0.5,
    towardBlue: 0.5,
    randomColorPct: 0.1,
    speed: 0.5,
    speedVariancePct: 0.5,
    driftRadius: 1.4,
    sineWavePct: 0.1,
    regularWeight: 9,       // 9 : 1 → 90.00% regular, 10.00% high-flyers (matches the old 10%)
    highFlyerWeight: 1,
    highFlyerSpeedMul: 3,
    highFlyerYBoost: 14,
    pulseOnFracMin: 0.1,
    pulseOnFracMax: 1.0,
    fadeMinSec: 0,
    fadeMaxSec: 2,
    area: 70,               // tighter swarm around the player area (was 130 = far too sparse)
    yMin: 0.5,
    yMax: 18,
    ...over,
  };
}

// ── store (drives the live renderer + the panel) ───────────────────
interface FireflyState {
  species: FireflySpecies[];
  nextCode: number;        // next global code to hand out (built-ins start at 1)
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  togglePanel: () => void;
  addSpecies: (ownerId: string) => void;
  duplicateSpecies: (id: string, ownerId: string) => void;
  removeSpecies: (id: string) => void;
  updateSpecies: (id: string, patch: Partial<FireflySpecies>) => void;
  setSpecies: (s: FireflySpecies[]) => void;
  /** "@F<code>": enable the species with that global code if the caller may spawn it.
   *  Returns 'ok' | 'denied' | 'missing' for the on-screen toast. */
  spawnByCode: (code: number, perm: { userId: string; isAdmin: boolean }) => 'ok' | 'denied' | 'missing';
}

export const useFireflyStore = create<FireflyState>((set, get) => ({
  species: [defaultSpecies({ code: 1, name: 'Wisp' })],
  nextCode: 2,
  panelOpen: false,
  setPanelOpen: (b) => set({ panelOpen: b }),
  togglePanel: () => set((st) => ({ panelOpen: !st.panelOpen })),
  addSpecies: (ownerId) => set((st) => ({
    species: [...st.species, defaultSpecies({ name: `Species ${st.species.length + 1}`, code: st.nextCode, ownerId, enabled: true })],
    nextCode: st.nextCode + 1,
  })),
  duplicateSpecies: (id, ownerId) => set((st) => {
    const src = st.species.find((s) => s.id === id);
    if (!src) return st;
    return {
      species: [...st.species, { ...src, id: newSpeciesId(), code: st.nextCode, ownerId, name: `${src.name} copy` }],
      nextCode: st.nextCode + 1,
    };
  }),
  removeSpecies: (id) => set((st) => ({ species: st.species.filter((s) => s.id !== id) })),
  updateSpecies: (id, patch) => set((st) => ({ species: st.species.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
  setSpecies: (s) => set({ species: s }),
  spawnByCode: (code, perm) => {
    const sp = get().species.find((s) => s.code === code);
    if (!sp) return 'missing';
    // built-ins (ownerId '') are spawnable by anyone; otherwise must own it, unless admin/superadmin.
    const mayUse = perm.isAdmin || sp.ownerId === '' || sp.ownerId === perm.userId;
    if (!mayUse) return 'denied';
    if (!sp.enabled) set((st) => ({ species: st.species.map((s) => (s.id === sp.id ? { ...s, enabled: true } : s)) }));
    return 'ok';
  },
}));
