// External store for the Fortress Builder. Used by BOTH the DOM panel and the
// in-Canvas preview — a module store (not React context) because context does not
// bridge across the R3F <Canvas> boundary. Subscribe via useBuilder().
import { useSyncExternalStore } from 'react';

export interface BuilderState {
  isOpen: boolean;
  imageSrc: string | null;   // data URL or /public path
  imageName: string;
  D: number;                 // overall diameter (blocks); fortress = 60% of this
  T: number;                 // wall thickness (1..5)
  heightScale: number;       // multiplies silhouette height
  tintHex: string;           // color tint over the grey tiers
  blockCount: number;        // published back by the preview
}

const initial: BuilderState = {
  isOpen: false,
  imageSrc: null,
  imageName: '',
  D: 67,
  T: 3,
  heightScale: 1,
  tintHex: '#ffffff',
  blockCount: 0,
};

let state: BuilderState = initial;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const builderStore = {
  get: (): BuilderState => state,
  set: (patch: Partial<BuilderState>): void => {
    state = { ...state, ...patch };
    emit();
  },
  toggleOpen: (): void => {
    state = { ...state, isOpen: !state.isOpen };
    emit();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useBuilder(): BuilderState {
  return useSyncExternalStore(builderStore.subscribe, builderStore.get, builderStore.get);
}
