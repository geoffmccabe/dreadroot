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
  prompt: string;            // text prompt for rebuilds (drives AI image-gen in a later phase)
  barrierOn: boolean;        // show + enforce the 20-60-20 monster barrier around the preview
  rebuildSeed: number;       // bumped by "Rebuild" to get a different variation
  faceSym: 'lr' | 'none';    // per-face symmetry
  faceFlip: boolean;         // flip which half is the mirror source
  wallSym: '4way' | '2way' | 'none'; // symmetry across the four walls
  entryW: number;            // entry tunnel width (blocks); 0 = no entry
  entryH: number;            // entry tunnel height (blocks)
  entryWall: number;         // 0 front, 1 right, 2 back, 3 left
  entryVert: number;         // lift the entry off the ground (0..5)
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
  prompt: '',
  barrierOn: false,
  rebuildSeed: 0,
  faceSym: 'none',
  faceFlip: false,
  wallSym: '4way',
  entryW: 4,
  entryH: 5,
  entryWall: 0,
  entryVert: 0,
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
