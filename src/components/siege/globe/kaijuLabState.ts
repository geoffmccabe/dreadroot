// kaijuLabState — which Kaiju is on the Mini Earth, and how big it is.
//
// Step D2/D3 of docs/MINI_EARTH_P1_BUILD.md. Deliberately a tiny external store in the same
// shape as the engine's other siege stores (subscribe + getSnapshot for useSyncExternalStore),
// so the HUD re-renders on change without any React state living in the render loop.
//
// THE SCALING MATHS (the part worth getting right)
// ------------------------------------------------
// Everything derives from ONE number: the ratio of the Kaiju's height to its model's natural
// height. From dynamic similarity, the same Froude-number argument behind film miniature work:
//
//   movement speed   scales with   sqrt(ratio)      a 9x taller creature moves 3x faster
//   animation rate   scales with   1 / sqrt(ratio)  ...and plays its cycles 3x slower
//
// So a giant covers ground quickly in absolute terms while looking slow and ponderous, which
// is exactly the intended read. Gravity is NOT reduced: at 1 unit = 1 metre a 100 m creature
// already falls slowly relative to its own body (one body height takes 4.5 s against a human's
// 0.6 s). Lowering gravity on top of that reads as moon gravity, a different effect entirely.

import { MONSTER_CATALOG, type MType } from '../siegeMonsterCatalog';
import { METRES_PER_UNIT } from './cubeSphere';

/**
 * Geoff's picks (2026-Jul-26): the four monsters that read as Kaiju. Skeletons, zombies,
 * hordes, ghosts and crawlies are horror-game enemies, not Kaiju, and are excluded.
 * Adding more later is a one-line change here.
 */
export const KAIJU_TYPES: MType[] = [17, 16, 15, 8] as MType[];
//                                   ^Fort ^Mech ^Elem ^Red Demon

/**
 * Starting height in GAME UNITS. On this map 1 unit = 100 real metres (METRES_PER_UNIT), so a
 * classic 100 m Kaiju is ONE unit tall.
 *
 * This was 100, which is 10 km real: a Kaiju taller than Everest is high, and 113x the height of
 * mini-Everest. The readout was correct and I had simply set the default in the wrong unit.
 */
const DEFAULT_HEIGHT = 1;
/** Each keypress changes size by this fraction. */
export const SCALE_STEP = 0.05;
const MIN_HEIGHT = 0.02;    // 2 m real, human scale
const MAX_HEIGHT = 200;     // 20 km real, far past anything sensible

export interface KaijuLabState {
  /** Index into KAIJU_TYPES. */
  index: number;
  type: MType;
  name: string;
  /** The model's natural height in units, from the catalog. */
  baseHeight: number;
  /** Current height in units. */
  height: number;
  /** Optional override for gravity, exposed so the physically correct answer can be overruled by eye. */
  gravityMul: number;
  /** Bumped on every change so the monster remounts at its new size. */
  generation: number;
}

function makeState(index: number, height?: number, gravityMul = 1, generation = 0): KaijuLabState {
  const type = KAIJU_TYPES[((index % KAIJU_TYPES.length) + KAIJU_TYPES.length) % KAIJU_TYPES.length];
  const entry = MONSTER_CATALOG.find((c) => c.id === type);
  return {
    index,
    type,
    name: entry?.name ?? `Type ${type}`,
    baseHeight: entry?.baseHeight ?? 2,
    height: height ?? DEFAULT_HEIGHT,
    gravityMul,
    generation,
  };
}

let state: KaijuLabState = makeState(0);
const listeners = new Set<() => void>();

function emit(next: KaijuLabState) {
  state = next;
  for (const l of listeners) l();
}

export function subscribeKaijuLab(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getKaijuLab(): KaijuLabState { return state; }

/** Step through the roster. `dir` is +1 or -1; wraps at both ends. */
export function cycleKaiju(dir: number): void {
  const n = KAIJU_TYPES.length;
  const next = makeState(((state.index + dir) % n + n) % n, state.height, state.gravityMul, state.generation + 1);
  emit(next);
}

/** Scale by 5% per step, compounding. `steps` is +1 or -1. */
export function scaleKaiju(steps: number): void {
  const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, state.height * Math.pow(1 + SCALE_STEP, steps)));
  emit({ ...state, height: h, generation: state.generation + 1 });
}

export function setKaijuGravityMul(g: number): void {
  emit({ ...state, gravityMul: Math.max(0, g), generation: state.generation + 1 });
}

export function resetKaijuSize(): void {
  emit({ ...state, height: DEFAULT_HEIGHT, generation: state.generation + 1 });
}

// --- derived values -------------------------------------------------------------------------

/**
 * Height relative to the model's natural size, comparing REAL metres to REAL metres. This one
 * number drives speed and animation.
 *
 * The two sides are in DIFFERENT unit systems and must be reconciled: `height` is in mini-Earth
 * units of 100 m, while the catalog's `baseHeight` is in DreadRoot metres (a Fort Golem is 12 m).
 * Dividing them directly was wrong, and only looked right because the old default of 100 units
 * happened to give the same 8.33 ratio that 1 unit gives correctly.
 */
export function sizeRatio(s: KaijuLabState = state): number {
  const realMetres = s.height * METRES_PER_UNIT;
  return realMetres / Math.max(0.01, s.baseHeight);
}

/** The Kaiju's height in real-world metres, which is how a Kaiju is normally described. */
export function realMetres(s: KaijuLabState = state): number {
  return s.height * METRES_PER_UNIT;
}

/** Movement speed multiplier: sqrt(ratio). See the header. */
export function speedMul(s: KaijuLabState = state): number {
  return Math.sqrt(sizeRatio(s));
}

/** Animation playback multiplier: 1/sqrt(ratio), i.e. bigger plays slower. */
export function animSpeedMul(s: KaijuLabState = state): number {
  return 1 / Math.sqrt(sizeRatio(s));
}
