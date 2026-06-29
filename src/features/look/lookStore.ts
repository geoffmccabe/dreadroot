// Live, tunable state for the global "look" (tone mapping, bloom, IBL). External
// reactive store (same pattern as shadowStore) so the Lightning Panel — which lives in
// the DOM, OUTSIDE the R3F Canvas — can drive the in-Canvas render components across
// the boundary, and so values persist across reloads for testing.
//
// Defaults come from lookConfig.LOOK. Persisted to localStorage under LOOK_KEY.
import { useSyncExternalStore } from 'react';
import {
  AgXToneMapping, ACESFilmicToneMapping, NeutralToneMapping, LinearToneMapping,
  type ToneMapping,
} from 'three';
import { LOOK } from './lookConfig';

export type ToneMappingChoice = 'agx' | 'aces' | 'neutral' | 'linear';

/** Maps a UI tone-mapping choice to its three.js constant. */
export const TONE_MAPPING_THREE: Record<ToneMappingChoice, ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
  linear: LinearToneMapping,
};

export interface LookState {
  toneMapping: ToneMappingChoice;
  exposure: number;
  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  iblIntensity: number;
}

export const LOOK_DEFAULTS: LookState = {
  toneMapping: 'agx',
  exposure: LOOK.exposure,
  bloomEnabled: true,
  bloomIntensity: LOOK.bloom.intensity,
  bloomThreshold: LOOK.bloom.luminanceThreshold,
  bloomRadius: LOOK.bloom.radius,
  iblIntensity: LOOK.ibl.intensity,
};

const LOOK_KEY = 'dreadroot.look.v1';

function load(): LookState {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(LOOK_KEY);
    if (raw) return { ...LOOK_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore corrupt/blocked storage */ }
  return { ...LOOK_DEFAULTS };
}

// `base` = the GLOBAL look (free-roam default), persisted to localStorage.
// `override` = an optional per-INSTANCE look (a challenge or world) that takes over while you're
// inside it, WITHOUT touching the global. The renderer always reads the effective look = override ?? base,
// so entering/leaving a challenge swaps the mood and restores it cleanly. Edits made while an override
// is active go to the override (and an optional persist callback saves them to that instance), never to
// the global. This is what makes lighting "per-instance" instead of one shared global setting.
let base: LookState = load();
let override: LookState | null = null;
let overrideKey: string | null = null;            // e.g. "challenge:<id>" — guards against stale exits
let overridePersist: ((look: LookState) => void) | null = null;
const listeners = new Set<() => void>();

const effective = (): LookState => override ?? base;

function persistBase() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(base)); } catch { /* ignore */ }
}

export const lookStore = {
  get: (): LookState => effective(),
  /** True when a per-instance look is currently overriding the global. */
  hasOverride: (): boolean => override !== null,
  getOverrideKey: (): string | null => overrideKey,
  set: <K extends keyof LookState>(key: K, value: LookState[K]) => {
    const cur = effective();
    if (cur[key] === value) return;
    if (override) {
      override = { ...override, [key]: value };
      overridePersist?.(override);
    } else {
      base = { ...base, [key]: value };
      persistBase();
    }
    listeners.forEach((l) => l());
  },
  // reset always targets the GLOBAL default (the override is per-instance and edited live).
  reset: () => {
    base = { ...LOOK_DEFAULTS };
    persistBase();
    if (!override) listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};

/** Enter a per-instance look. `look` = the instance's saved look (or undefined to inherit the current
 *  global). `persist` (optional) is called with the full look whenever it's edited, so the owner can
 *  save it back to that instance. Idempotent-ish: re-entering replaces the active override. */
export function enterLookContext(key: string, look: Partial<LookState> | undefined, persist?: (look: LookState) => void) {
  override = { ...base, ...(look ?? {}) };
  overrideKey = key;
  overridePersist = persist ?? null;
  listeners.forEach((l) => l());
}

/** Leave the per-instance look and restore the global. If `key` is given it must match the active
 *  context (so a late cleanup from an old challenge can't clobber a newer one). */
export function exitLookContext(key?: string) {
  if (override === null) return;
  if (key && overrideKey !== key) return;
  override = null;
  overrideKey = null;
  overridePersist = null;
  listeners.forEach((l) => l());
}

export function useLook(): LookState {
  return useSyncExternalStore(lookStore.subscribe, lookStore.get, lookStore.get);
}
