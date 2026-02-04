/**
 * Pathfinding Service
 *
 * Main service class that handles pathfinding requests.
 * Uses the algorithm registry to find paths with different algorithms.
 */

import * as THREE from 'three';
import type {
  PathfindingRequest,
  PathfindingResult,
  AlgorithmOptions,
  PathfindingConfig,
} from './types';
import { algorithmRegistry } from './algorithmRegistry';
import { applyRandomization } from './randomization';
import { playerTracker } from '@/lib/playerTracker';
import { requestPathAsync, isWorkerAvailable } from './workerBridge';

// Default values
const DEFAULT_GRID_SIZE = 2;
const DEFAULT_MAX_ITERATIONS = 3000;
const DEFAULT_MAX_PATH_LENGTH = 500;

class PathfindingServiceClass {
  // Cache of database configs (populated by admin panel)
  private configCache = new Map<string, PathfindingConfig>();

  /**
   * Find a path using the specified algorithm
   */
  findPath(request: PathfindingRequest): PathfindingResult {
    const startTime = performance.now();

    // Resolve target position
    const targetPos = this.resolveTarget(request);
    if (!targetPos) {
      return {
        success: false,
        path: null,
        algorithmUsed: request.algorithmCode,
        computeTimeMs: performance.now() - startTime,
        error: 'Could not resolve target position',
      };
    }

    // Get algorithm
    const algorithm = algorithmRegistry.get(request.algorithmCode);
    if (!algorithm) {
      // Fallback to default
      const defaultAlgo = algorithmRegistry.getDefault();
      if (!defaultAlgo) {
        return {
          success: false,
          path: null,
          algorithmUsed: request.algorithmCode,
          computeTimeMs: performance.now() - startTime,
          error: `Algorithm "${request.algorithmCode}" not found and no default available`,
        };
      }
      console.warn(`[Pathfinding] Algorithm "${request.algorithmCode}" not found, using default "${defaultAlgo.code}"`);
      return this.executeAlgorithm(defaultAlgo.code, request, targetPos, startTime);
    }

    return this.executeAlgorithm(request.algorithmCode, request, targetPos, startTime);
  }

  /**
   * Execute pathfinding with a specific algorithm
   */
  private executeAlgorithm(
    algorithmCode: string,
    request: PathfindingRequest,
    targetPos: { x: number; z: number },
    startTime: number
  ): PathfindingResult {
    const algorithm = algorithmRegistry.get(algorithmCode)!;

    // Build options
    const options: AlgorithmOptions = {
      gridSize: request.gridSize ?? DEFAULT_GRID_SIZE,
      maxIterations: request.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxPathLength: DEFAULT_MAX_PATH_LENGTH,
      algorithmParams: request.algorithmParams,
    };

    // Execute algorithm
    const result = algorithm.findPath(
      request.fromX,
      request.fromZ,
      targetPos.x,
      targetPos.z,
      request.entityRadius,
      request.entityHeight,
      options
    );

    const computeTime = performance.now() - startTime;

    if (!result.path || result.path.length === 0) {
      return {
        success: false,
        path: null,
        algorithmUsed: algorithmCode,
        computeTimeMs: computeTime,
        nodesExplored: result.nodesExplored,
        error: 'No path found',
      };
    }

    // Apply randomization if requested
    let finalPath = result.path;
    if (request.randomization && request.randomization > 0) {
      finalPath = applyRandomization(
        result.path,
        request.randomization,
        request.randomizationMode || 'straight',
        request.entityRadius,
        request.entityHeight
      );
    }

    return {
      success: true,
      path: finalPath,
      algorithmUsed: algorithmCode,
      computeTimeMs: computeTime,
      nodesExplored: result.nodesExplored,
    };
  }

  /**
   * Resolve target position from request
   */
  private resolveTarget(request: PathfindingRequest): { x: number; z: number } | null {
    // Direct position
    if (request.targetPosition) {
      return request.targetPosition;
    }

    // Entity by ID
    if (request.targetEntityId) {
      // Try player tracker first
      const player = playerTracker.getPlayerById(request.targetEntityId);
      if (player) {
        return { x: player.position.x, z: player.position.z };
      }

      // Could add enemy tracker, NPC tracker, etc. here
      console.warn(`[Pathfinding] Could not find entity with ID: ${request.targetEntityId}`);
      return null;
    }

    // Target type without ID - find nearest
    if (request.targetType === 'player') {
      const nearestPlayer = playerTracker.getNearestPlayer(
        new THREE.Vector3(request.fromX, 0, request.fromZ)
      );
      if (nearestPlayer) {
        return { x: nearestPlayer.position.x, z: nearestPlayer.position.z };
      }
    }

    return null;
  }

  /**
   * Find a path using a named configuration from the database
   */
  findPathWithConfig(
    configCode: string,
    fromX: number,
    fromZ: number,
    targetX: number,
    targetZ: number,
    entityRadius: number,
    entityHeight: number
  ): PathfindingResult {
    const config = this.configCache.get(configCode);

    // Log warning if config not found (cache may not be populated yet)
    if (!config && configCode !== 'astar_default') {
      console.warn(`[Pathfinding] Config "${configCode}" not in cache, using defaults`);
    }

    // Validate randomization mode to ensure type safety
    const rawMode = config?.randomization_mode;
    const randomizationMode: 'straight' | 'curved' | 'jagged' =
      rawMode === 'curved' || rawMode === 'jagged' ? rawMode : 'straight';

    const request: PathfindingRequest = {
      fromX,
      fromZ,
      targetPosition: { x: targetX, z: targetZ },
      entityRadius,
      entityHeight,
      algorithmCode: config?.algorithm_code ?? algorithmRegistry.getDefaultCode(),
      gridSize: config?.grid_size ?? DEFAULT_GRID_SIZE,
      maxIterations: config?.max_iterations ?? DEFAULT_MAX_ITERATIONS,
      randomization: config?.default_randomization ?? 0,
      randomizationMode,
      algorithmParams: config?.algorithm_params || undefined,
    };

    return this.findPath(request);
  }

  /**
   * Find a path asynchronously using the Web Worker.
   * Falls back to synchronous findPathWithConfig if worker is unavailable.
   */
  async findPathAsync(
    configCode: string,
    fromX: number,
    fromZ: number,
    goalX: number,
    goalZ: number,
    entityRadius: number,
    entityHeight: number,
    entityFeetY: number
  ): Promise<PathfindingResult> {
    if (!isWorkerAvailable()) {
      // Fallback to synchronous on main thread
      return this.findPathWithConfig(configCode, fromX, fromZ, goalX, goalZ, entityRadius, entityHeight);
    }

    const config = this.configCache.get(configCode);

    try {
      return await requestPathAsync({
        startX: fromX,
        startZ: fromZ,
        goalX,
        goalZ,
        entityRadius,
        entityHeight,
        entityFeetY,
        gridSize: config?.grid_size ?? DEFAULT_GRID_SIZE,
        maxIterations: config?.max_iterations ?? DEFAULT_MAX_ITERATIONS,
      });
    } catch {
      // Worker failed — fall back to synchronous
      return this.findPathWithConfig(configCode, fromX, fromZ, goalX, goalZ, entityRadius, entityHeight);
    }
  }

  /**
   * Update the config cache (called by admin panel hooks)
   */
  setConfigCache(configs: PathfindingConfig[]): void {
    this.configCache.clear();
    for (const config of configs) {
      this.configCache.set(config.code, config);
    }
    console.log(`[Pathfinding] Config cache updated with ${configs.length} configs`);
  }

  /**
   * Get a cached config by code
   */
  getConfig(code: string): PathfindingConfig | null {
    return this.configCache.get(code) || null;
  }

  /**
   * Get all available algorithm info (for admin panel)
   */
  getAlgorithms() {
    return algorithmRegistry.getAllInfo();
  }

  /**
   * Check if an algorithm is registered
   */
  hasAlgorithm(code: string): boolean {
    return algorithmRegistry.has(code);
  }
}

// Singleton instance
export const pathfindingService = new PathfindingServiceClass();
