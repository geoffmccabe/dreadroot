/**
 * Algorithm Registry
 *
 * Central registry for all available pathfinding algorithms.
 * Algorithms register themselves here and can be looked up by code.
 */

import type { PathfindingAlgorithm, AlgorithmInfo } from './types';

class AlgorithmRegistryClass {
  private algorithms = new Map<string, PathfindingAlgorithm>();
  private defaultAlgorithm: string | null = null;

  /**
   * Register a pathfinding algorithm
   */
  register(algorithm: PathfindingAlgorithm): void {
    if (this.algorithms.has(algorithm.code)) {
      console.warn(`[PathfindingRegistry] Algorithm "${algorithm.code}" already registered, overwriting`);
    }
    this.algorithms.set(algorithm.code, algorithm);

    if (algorithm.isDefault) {
      this.defaultAlgorithm = algorithm.code;
    }

    console.log(`[PathfindingRegistry] Registered algorithm: ${algorithm.code}`);
  }

  /**
   * Get an algorithm by code
   */
  get(code: string): PathfindingAlgorithm | null {
    return this.algorithms.get(code) || null;
  }

  /**
   * Get the default algorithm
   */
  getDefault(): PathfindingAlgorithm | null {
    if (this.defaultAlgorithm) {
      return this.algorithms.get(this.defaultAlgorithm) || null;
    }
    // Fallback to first registered algorithm
    const first = this.algorithms.values().next().value;
    return first || null;
  }

  /**
   * Get the default algorithm code
   */
  getDefaultCode(): string {
    return this.defaultAlgorithm || 'astar';
  }

  /**
   * Check if an algorithm exists
   */
  has(code: string): boolean {
    return this.algorithms.has(code);
  }

  /**
   * Get all registered algorithm codes
   */
  getCodes(): string[] {
    return Array.from(this.algorithms.keys());
  }

  /**
   * Get info for all algorithms (for admin panel display)
   */
  getAllInfo(): AlgorithmInfo[] {
    return Array.from(this.algorithms.values()).map(algo => ({
      code: algo.code,
      name: algo.name,
      description: algo.description,
      category: algo.category,
    }));
  }

  /**
   * Get algorithms by category
   */
  getByCategory(category: string): AlgorithmInfo[] {
    return Array.from(this.algorithms.values())
      .filter(algo => algo.category === category)
      .map(algo => ({
        code: algo.code,
        name: algo.name,
        description: algo.description,
        category: algo.category,
      }));
  }

  /**
   * Get total count of registered algorithms
   */
  get count(): number {
    return this.algorithms.size;
  }
}

// Singleton instance
export const algorithmRegistry = new AlgorithmRegistryClass();
