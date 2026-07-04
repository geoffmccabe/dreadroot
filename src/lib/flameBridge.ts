// flameBridge — a tiny global handle to the UniversalFlameRenderer (which lives in FortressScene and
// is normally reached via a ref prop). Lets systems outside that subtree — e.g. the Siege self-avatar's
// jet-boot flames — spawn the sprite flames without prop-drilling the ref through the whole tree.
import type * as THREE from 'three';

export interface FlameSpawnConfig {
  type: 'point' | 'hex' | 'plume';
  position: THREE.Vector3;
  colors: string[];
  size?: number;
  height?: number;
  duration?: number;
  particleCount?: number;
  attachTo?: string;
  colorMode?: 'static' | 'rainbow' | 'black';
  flipY?: boolean;      // point fire downward (rocket-boot jets)
  speedMul?: number;    // point fire animation-speed multiplier
  particleAspect?: number;  // point fire per-particle height:width (5-8 = thin vertical streak)
}
export interface FlameSpawner {
  spawnFlame: (c: FlameSpawnConfig) => string;
  updateAttachedPosition: (attachId: string, position: THREE.Vector3) => void;
  removeAttached: (attachId: string) => void;
}

let spawner: FlameSpawner | null = null;
export const setUniversalFlame = (s: FlameSpawner | null): void => { spawner = s; };
export const getUniversalFlame = (): FlameSpawner | null => spawner;
