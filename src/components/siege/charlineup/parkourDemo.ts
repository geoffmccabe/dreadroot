// parkourDemo — the obstacle presets the lineup demo cycles through (press J). Each is a synthetic
// Surroundings reading (exactly what the real voxel scanner produces) plus a box to draw, so you can
// SEE what the character is vaulting / diving / sliding / dropping. Cycling them shows the classifier
// pick a different move per size.
//
// These now feed the REAL classifier in src/features/parkour/moves.ts. They used to feed a second,
// private copy with its own thresholds, which is how the preview and the game drifted apart.
import { UNMEASURED, type Surroundings } from '@/features/parkour';

export interface ObstaclePreset {
  label: string;
  reading: Surroundings;
  // box to render ahead of the character (metres). null = no geometry (the ledge/drop case).
  box: { w: number; h: number; d: number; yBottom: number } | null;
  color: string;
}

// Distance ahead of the character the obstacle sits (metres). The run-up drift covers roughly this.
export const OBSTACLE_DIST = 1.8;

/** Fields a synthetic obstacle shares: it is always straight ahead, at ground level, with open sky
 *  above unless the preset says otherwise. */
const AT = (height: number, depth: number, extra: Partial<Surroundings> = {}): Surroundings => ({
  height, depth,
  headroom: 4,
  topY: height,
  distance: OBSTACLE_DIST,
  standable: true,
  farSideY: 0,
  ...UNMEASURED,
  ...extra,
});

export const OBSTACLE_PRESETS: ObstaclePreset[] = [
  { label: '1m block → vault',     reading: AT(1.0, 0.4), box: { w: 1.0, h: 1.0, d: 0.4, yBottom: 0 },   color: '#6a8caf' },
  { label: '2m block → dive over', reading: AT(2.0, 0.5), box: { w: 1.2, h: 2.0, d: 0.5, yBottom: 0 },   color: '#6a8caf' },
  { label: 'overhead bar → slide', reading: AT(2.2, 0.3, { clearanceBelow: 0.9 }), box: { w: 1.4, h: 0.3, d: 0.4, yBottom: 0.95 }, color: '#af8c6a' },
  { label: 'ledge → drop + roll',  reading: AT(0, 0, { dropAhead: 2.0, farSideY: -2 }), box: null,        color: '#888888' },
  { label: '3m wall → wall-run',   reading: AT(3.0, 1.0, { standable: false }), box: { w: 1.6, h: 3.0, d: 0.6, yBottom: 0 }, color: '#7a6aaf' },
];
