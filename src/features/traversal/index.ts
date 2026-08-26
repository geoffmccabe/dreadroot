/**
 * Traversal — one probe, many moves.
 *
 * Install the probe that matches the world; everything downstream is written
 * against the measurement, not the world model.
 */
export type { ObstacleProbe, ObstacleReading } from './obstacleProbe';
export { getObstacleProbe, setObstacleProbe } from './obstacleProbe';
export { VoxelObstacleProbe } from './voxelObstacleProbe';
export { MeshObstacleProbe } from './meshObstacleProbe';
export {
  chooseTraversal, STEP_UP_MAX, MANTLE_MAX, THIN_DEPTH, CRAWL_HEADROOM,
  type TraversalMove, type TraversalChoice,
} from './traversalMoves';

import { setObstacleProbe } from './obstacleProbe';
import { VoxelObstacleProbe } from './voxelObstacleProbe';
import { MeshObstacleProbe } from './meshObstacleProbe';

/** Pick the probe for the running game. Called once at world start. */
export function installObstacleProbe(usesVoxels: boolean): void {
  setObstacleProbe(usesVoxels ? new VoxelObstacleProbe() : new MeshObstacleProbe());
}
