// Flame effect preset definitions for the Effects admin panel
// Code-only presets (no database) — visual tuning consumed client-side only

export type FlameSystem = 'tpf' | 'ufr';

export type FlameType = 'point' | 'hex' | 'plume';
export type TpfType = 'single' | 'hex-impact';
export type FlameColorMode = 'static' | 'rainbow' | 'black';

export interface FlameEffectPreset {
  id: string;
  name: string;
  system: FlameSystem;
  type: FlameType | TpfType;
  defaults: {
    size: number;
    height: number;
    duration: number;
    particleCount: number;
    colors: string[];
    colorMode?: FlameColorMode;
  };
}

export const FLAME_PRESETS: FlameEffectPreset[] = [
  {
    id: 'tpf-hex-impact',
    name: 'Hex Impact (Volumetric)',
    system: 'tpf',
    type: 'hex-impact',
    defaults: {
      size: 0.5,
      height: 1.0,
      duration: 0.5,
      particleCount: 80,
      colors: ['#FFFF00', '#FF6600', '#FF3300'],
    },
  },
  {
    id: 'tpf-single',
    name: 'Single Fire (Volumetric)',
    system: 'tpf',
    type: 'single',
    defaults: {
      size: 0.5,
      height: 1.0,
      duration: 1.0,
      particleCount: 80,
      colors: ['#FFAA00', '#FF3300', '#FF0000'],
    },
  },
  {
    id: 'ufr-point',
    name: 'Point Fire (Sprite)',
    system: 'ufr',
    type: 'point',
    defaults: {
      size: 0.5,
      height: 1.0,
      duration: 1.0,
      particleCount: 80,
      colors: ['#FFFF00', '#FF6600', '#FF3300'],
      colorMode: 'static',
    },
  },
  {
    id: 'ufr-hex',
    name: 'Hex Fire (Sprite)',
    system: 'ufr',
    type: 'hex',
    defaults: {
      size: 0.5,
      height: 1.0,
      duration: 0.5,
      particleCount: 60,
      colors: ['#FFFF00', '#FF6600', '#FF3300'],
      colorMode: 'static',
    },
  },
  {
    id: 'ufr-plume',
    name: 'Jet Plume (Sprite)',
    system: 'ufr',
    type: 'plume',
    defaults: {
      size: 0.5,
      height: 1.0,
      duration: 1.0,
      particleCount: 60,
      colors: ['#FF6600', '#FF3300', '#CC2200'],
      colorMode: 'static',
    },
  },
];
