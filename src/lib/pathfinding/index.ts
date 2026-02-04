/**
 * Universal Pathfinding System
 *
 * Main entry point for the pathfinding library.
 * Import algorithms to auto-register them with the registry.
 */

// Export types
export type {
  PathfindingRequest,
  PathfindingResult,
  PathfindingAlgorithm,
  PathfindingAlgorithmResult,
  PathfindingConfig,
  PathfindingConfigFormData,
  AlgorithmOptions,
  AlgorithmInfo,
  RandomizationMode,
  AlgorithmCategory,
  TargetType,
} from './types';

// Export registry
export { algorithmRegistry } from './algorithmRegistry';

// Export service
export { pathfindingService } from './pathfindingService';

// Export randomization
export { applyRandomization } from './randomization';

// Export worker bridge
export { initPathfindingWorker, terminatePathfindingWorker } from './workerBridge';

// Import algorithms to register them (order matters for default)
import './algorithms/astar';
import './algorithms/astarWeighted';
import './algorithms/dijkstra';
import './algorithms/bfs';
import './algorithms/greedyBest';
import './algorithms/steering';
import './algorithms/jps';

// Initialize pathfinding Web Worker for off-thread computation
import { initPathfindingWorker } from './workerBridge';
initPathfindingWorker();

// Log registration complete
console.log('[Pathfinding] System initialized');
