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

let state: LookState = load();
const listeners = new Set<() => void>();

function persist() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export const lookStore = {
  get: (): LookState => state,
  set: <K extends keyof LookState>(key: K, value: LookState[K]) => {
    if (state[key] === value) return;
    state = { ...state, [key]: value };
    persist();
    listeners.forEach((l) => l());
  },
  reset: () => {
    state = { ...LOOK_DEFAULTS };
    persist();
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};

export function useLook(): LookState {
  return useSyncExternalStore(lookStore.subscribe, lookStore.get, lookStore.get);
}
