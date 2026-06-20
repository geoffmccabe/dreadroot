// External store bridging the DOM Lights panel and the in-Canvas preview (context
// doesn't cross the R3F Canvas, so we use a module store like the Fortress Builder).
import { useSyncExternalStore } from 'react';
import { DEFAULT_LIGHT, type LightDef } from './lightTypes';

export interface LightStoreState {
  previewOn: boolean;
  def: LightDef;
}

let state: LightStoreState = { previewOn: false, def: { ...DEFAULT_LIGHT } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const lightStore = {
  get: (): LightStoreState => state,
  setPreview: (on: boolean) => { state = { ...state, previewOn: on }; emit(); },
  setDef: (patch: Partial<LightDef>) => { state = { ...state, def: { ...state.def, ...patch } }; emit(); },
  replaceDef: (def: LightDef) => { state = { ...state, def }; emit(); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};

export function useLightStore(): LightStoreState {
  return useSyncExternalStore(lightStore.subscribe, lightStore.get, lightStore.get);
}
