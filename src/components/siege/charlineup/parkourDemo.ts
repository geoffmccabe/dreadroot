// parkourDemo — the obstacle presets the lineup demo cycles through (press J). Each is a synthetic
// ObstacleProbe (what the detector reads) plus a box to draw so you can SEE what the character is
// vaulting/diving/sliding/dropping. Cycling them shows the detector pick a different move per size.
import { ObstacleProbe } from './obstacleDetector';

export interface ObstaclePreset {
  label: string;
  probe: ObstacleProbe;
  // box to render ahead of the character (metres). null = no geometry (the ledge/drop case).
  box: { w: number; h: number; d: number; yBottom: number } | null;
  color: string;
}

// Distance ahead of the character the obstacle sits (metres). The run-up drift covers roughly this.
export const OBSTACLE_DIST = 1.8;

export const OBSTACLE_PRESETS: ObstaclePreset[] = [
  { label: '1m block → vault',        probe: { height: 1.0, depth: 0.4, clearanceBelow: null, dropAhead: 0 },   box: { w: 1.0, h: 1.0, d: 0.4, yBottom: 0 },   color: '#6a8caf' },
  { label: '2m block → dive over',    probe: { height: 2.0, depth: 0.5, clearanceBelow: null, dropAhead: 0 },   box: { w: 1.2, h: 2.0, d: 0.5, yBottom: 0 },   color: '#6a8caf' },
  { label: 'overhead bar → slide',    probe: { height: 2.2, depth: 0.3, clearanceBelow: 0.9, dropAhead: 0 },    box: { w: 1.4, h: 0.3, d: 0.4, yBottom: 0.95 }, color: '#af8c6a' },
  { label: 'ledge → drop + roll',     probe: { height: 0,   depth: 0,   clearanceBelow: null, dropAhead: 2.0 }, box: null,                                     color: '#888888' },
  { label: '3m wall → wall-run',      probe: { height: 3.0, depth: 1.0, clearanceBelow: null, dropAhead: 0 },   box: { w: 1.6, h: 3.0, d: 0.6, yBottom: 0 },   color: '#7a6aaf' },
];
