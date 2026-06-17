// Spray Attack — a reusable, parameterized "breath weapon" for monsters. Particles
// fire out like bullets (initial velocity in a cone), then fall under gravity. Hitting
// the player deals damage + plays a short impact sound (volume scaled by impact speed).
// Change the params to make acid vomit, flames, spores, ice shards, etc. Designed to be
// dropped into the monster creator later (each field = one knob in a "Spray Attack" panel).
export type SpraySprite = 'circle' | 'oval' | 'diamond' | 'line' | 'square' | 'star';

export interface SprayConfig {
  count: number;             // particles per shot
  speedKph: number;          // muzzle speed (km/h) — determines range with gravity
  speedVar: number;          // ± fraction on speed (0.25 = ±25%)
  coneDeg: number;           // full spread cone angle (3D solid angle)
  broadConeDeg?: number;     // wider cone used on a fraction of shots (harder to dodge)
  broadChance?: number;      // 0-1 chance a given shot uses broadConeDeg instead of coneDeg
  gravity: number;           // m/s² pulling particles down
  colorA: [number, number, number];   // RGB 0-1; each particle is a random lerp A↔B
  colorB: [number, number, number];
  size: number;              // base sprite radius (m)
  sizeVar: number;           // ± size fraction
  opacityMin: number;        // per-particle opacity range (0-1)
  opacityMax: number;
  sprites: SpraySprite[];    // shape pool — each particle picks one at random
  emitWindow: number;        // s — particles spray out over this window (not all at once)
  soundUrl: string;          // sound played as each blob LEAVES the mouth
  soundClipStart: number;    // s into the file to start (snippet from the middle)
  soundClipDur: number;      // s length of the snippet
  soundMaxKph: number;       // muzzle speed (km/h) that maps to 100% volume
  damage: number;            // HP per particle hit
  lifetime: number;          // s before a particle expires
  hitRadius: number;         // m — distance to player that counts as a hit
}

// km/h → m/s
export const KPH = 1 / 3.6;

// The acid-vomit preset Geoff specified.
export const ACID_VOMIT: SprayConfig = {
  count: 260,
  speedKph: 80,
  speedVar: 0.25,
  coneDeg: 10,
  broadConeDeg: 30,    // 1-in-5 shots spray wide so the player can't always sidestep
  broadChance: 0.2,
  gravity: 16,
  colorA: [0.85, 0.06, 0.05],  // deep red
  colorB: [0.92, 0.55, 0.42],  // flesh
  size: 0.085,
  sizeVar: 0.5,
  opacityMin: 0.3,
  opacityMax: 0.8,
  sprites: ['circle', 'oval', 'diamond', 'square', 'line'],  // no stars in vomit (star stays a builder option)
  emitWindow: 1.0,
  soundUrl: '/enemy_hitting_ground.mp3',
  soundClipStart: 0.22,
  soundClipDur: 0.1,
  soundMaxKph: 80,
  damage: 1,
  lifetime: 2.5,
  hitRadius: 0.55,
};
