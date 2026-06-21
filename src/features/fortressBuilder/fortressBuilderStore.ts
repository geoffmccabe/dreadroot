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
  chunk: number;             // block size (1 fine .. 5 chunky rectangles)
  parapetOn: boolean;        // solid corner towers (default on, Khaured look)
  parapetWidth: number;      // extra width beyond T+2
  parapetHeight: number;     // extra height beyond the random 2..10
  entryW: number;            // entry tunnel width (blocks); 0 = no entry
  entryH: number;            // entry tunnel height (blocks)
  entryWall: number;         // 0 front, 1 right, 2 back, 3 left
  entryVert: number;         // lift the entry off the ground (0..5)
  stairs: boolean;           // build stairs up to a lifted entry (outside + mirrored inside)
  // Extrude: per grey tier (index 0..4), amount on the outer / inner face.
  // + protrudes (max +2), - recesses into the wall (down to -wallThickness = through).
  extrudeOut: number[];
  extrudeIn: number[];
  exTier: number;            // selected tier (0..4) in the panel
  exFace: 'outside' | 'inside'; // which face the +/- buttons act on
  // Lighting on extruded/inset parts. The sides emit a glow (emissive) AND real point
  // lights wash the wall they were extruded from. Spread = how far that wash reaches.
  extrudeLightOn: boolean;
  extrudeLightColor: string;
  extrudeLightIntensity: number;
  extrudeLightSpread: number;
  insetLightOn: boolean;
  insetLightColor: string;
  insetLightIntensity: number;
  insetLightSpread: number;
}

const initial: BuilderState = {
  isOpen: false,
  imageSrc: '/Khaured_fortress.jpg', // fixed Khaured silhouette for everyone (no upload UI)
  imageName: 'Khaured',
  D: 67,
  T: 3,
  heightScale: 1,
  tintHex: '#ffffff',
  blockCount: 0,
  prompt: '',
  barrierOn: false,
  rebuildSeed: 0,
  faceSym: 'lr',
  faceFlip: false,
  wallSym: '4way',
  chunk: 3,
  parapetOn: true,
  parapetWidth: 0,
  parapetHeight: 0,
  entryW: 4,
  entryH: 9,
  entryWall: 0,
  entryVert: 0,
  stairs: true,
  // Default nice combo: recess the 2nd-lightest tier (idx1) by 1 (lit niche), and
  // extrude the 2nd-darkest tier (idx3) outward by 1 (relief).
  extrudeOut: [0, -1, 0, 1, 0],
  extrudeIn: [0, 0, 0, 0, 0],
  exTier: 0,
  exFace: 'outside',
  extrudeLightOn: false,
  extrudeLightColor: '#7a4dff', // blue-purple
  extrudeLightIntensity: 1.0,
  extrudeLightSpread: 10,
  insetLightOn: true,
  insetLightColor: '#ff5a1f',   // red-orange
  insetLightIntensity: 1.0,
  insetLightSpread: 8,
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
