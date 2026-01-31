/**
 * Universal Pathfinding System - Type Definitions
 *
 * These types define the API for the pathfinding service that can be used
 * by any entity (enemies, NPCs, pets, vehicles, etc.)
 */

import * as THREE from 'three';

/**
 * Randomization modes for path variation
 */
export type RandomizationMode = 'straight' | 'curved' | 'jagged';

/**
 * Algorithm categories
 */
export type AlgorithmCategory = 'grid' | 'steering' | 'hybrid';

/**
 * Target types for pathfinding
 */
export type TargetType = 'position' | 'player' | 'enemy' | 'npc' | 'entity';

/**
 * Request to find a path
 */
export interface PathfindingRequest {
  // Source position (world coordinates)
  fromX: number;
  fromZ: number;

  // Target - specify ONE of these options
  targetPosition?: { x: number; z: number };
  targetEntityId?: string;
  targetType?: TargetType;

  // Entity dimensions for collision detection
  entityRadius: number;
  entityHeight: number;

  // Algorithm selection (code from registry)
  algorithmCode: string;

  // Randomization settings
  randomization?: number;           // Variance in meters (0 = perfect path)
  randomizationMode?: RandomizationMode;

  // Optional parameter overrides
  gridSize?: number;
  maxIterations?: number;

  // Algorithm-specific parameters (JSON object)
  algorithmParams?: Record<string, unknown>;
}

/**
 * Result of a pathfinding operation
 */
export interface PathfindingResult {
  success: boolean;
  path: THREE.Vector3[] | null;
  algorithmUsed: string;
  computeTimeMs: number;
  nodesExplored?: number;
  error?: string;
}

/**
 * Algorithm-specific options passed to implementations
 */
export interface AlgorithmOptions {
  gridSize: number;
  maxIterations: number;
  maxPathLength: number;
  algorithmParams?: Record<string, unknown>;
}

/**
 * Interface that all pathfinding algorithms must implement
 */
export interface PathfindingAlgorithm {
  // Unique identifier (used in database and API)
  code: string;

  // Display name (e.g., "A* Search")
  name: string;

  // Detailed description for admins
  description: string;

  // Category for grouping in UI
  category: AlgorithmCategory;

  // Whether this is the default algorithm
  isDefault?: boolean;

  // The actual pathfinding implementation
  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    entityRadius: number,
    entityHeight: number,
    options: AlgorithmOptions
  ): PathfindingAlgorithmResult;
}

/**
 * Internal result from algorithm implementation
 */
export interface PathfindingAlgorithmResult {
  path: THREE.Vector3[] | null;
  nodesExplored?: number;
}

/**
 * Database schema for pathfinding configurations
 */
export interface PathfindingConfig {
  id: string;
  code: string;
  name: string;
  description: string | null;
  algorithm_code: string;
  grid_size: number;
  max_iterations: number;
  default_randomization: number;
  randomization_mode: RandomizationMode;
  algorithm_params: Record<string, unknown> | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Form data for creating/editing pathfinding configs
 */
export interface PathfindingConfigFormData {
  code: string;
  name: string;
  description: string;
  algorithm_code: string;
  grid_size: number;
  max_iterations: number;
  default_randomization: number;
  randomization_mode: RandomizationMode;
  algorithm_params: Record<string, unknown>;
  is_default: boolean;
}

/**
 * Algorithm metadata for display in admin panel
 */
export interface AlgorithmInfo {
  code: string;
  name: string;
  description: string;
  category: AlgorithmCategory;
}
