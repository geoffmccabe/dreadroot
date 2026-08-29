/**
 * Parkour — one scanner, many moves.
 *
 * Install the scanner that matches the world; everything downstream is written
 * against the measurement, not the world model.
 */
export type { Scanner, Surroundings } from './surroundings';
export { getScanner, setScanner, UNMEASURED } from './surroundings';
export { VoxelScanner } from './voxelScanner';
export { MeshScanner } from './meshScanner';
export { chooseMove, THRESHOLDS, type ParkourMove, type ParkourChoice, type ParkourThresholds } from './moves';
export { useParkour, type ParkourController, type ParkourStep } from './useParkour';
export { parkourStats } from './stats';

import { setScanner } from './surroundings';
import { VoxelScanner } from './voxelScanner';
import { MeshScanner } from './meshScanner';

/** Pick the scanner for the running game. Called once at world start. */
export function installScanner(usesVoxels: boolean): void {
  setScanner(usesVoxels ? new VoxelScanner() : new MeshScanner());
}
