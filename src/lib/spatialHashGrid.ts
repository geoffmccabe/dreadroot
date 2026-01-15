import * as THREE from 'three';

/**
 * Spatial Hash Grid for O(1) collision lookups
 * ZERO-ALLOCATION implementation for hot path
 * 
 * Uses numeric cell indices instead of string keys
 * Uses generation counter for O(1) deduplication instead of O(n²) linear scan
 */

const CELL_SIZE = 4;
const GRID_OFFSET = 128; // Offset to handle negative coordinates (supports -128 to +128)
const GRID_WIDTH = 256;  // Total grid size
const MAX_NEARBY_RESULTS = 64; // Max colliders returned from getNearby

class SpatialHashGrid {
  // Use a 2D array indexed by (cellX + GRID_OFFSET) * GRID_WIDTH + (cellZ + GRID_OFFSET)
  private cells: THREE.Box3[][] = [];
  private colliderCellIndices: Map<THREE.Box3, number[]> = new Map();
  
  // Pre-allocated result array - reused every call to avoid GC
  private nearbyResult: THREE.Box3[] = new Array(MAX_NEARBY_RESULTS);
  private nearbyCount = 0;
  
  // Generation-based deduplication - O(1) instead of O(n²)
  private currentGeneration = 0;
  private colliderGeneration: Map<THREE.Box3, number> = new Map();
  
  constructor() {
    // Pre-allocate grid cells
    const totalCells = GRID_WIDTH * GRID_WIDTH;
    for (let i = 0; i < totalCells; i++) {
      this.cells[i] = [];
    }
  }
  
  private getCellIndex(x: number, z: number): number {
    const cx = Math.floor(x / CELL_SIZE) + GRID_OFFSET;
    const cz = Math.floor(z / CELL_SIZE) + GRID_OFFSET;
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(GRID_WIDTH - 1, cx));
    const clampedZ = Math.max(0, Math.min(GRID_WIDTH - 1, cz));
    return clampedX * GRID_WIDTH + clampedZ;
  }
  
  /**
   * Add a collider to the grid
   */
  insert(collider: THREE.Box3): void {
    const minCX = Math.floor(collider.min.x / CELL_SIZE) + GRID_OFFSET;
    const maxCX = Math.floor(collider.max.x / CELL_SIZE) + GRID_OFFSET;
    const minCZ = Math.floor(collider.min.z / CELL_SIZE) + GRID_OFFSET;
    const maxCZ = Math.floor(collider.max.z / CELL_SIZE) + GRID_OFFSET;
    
    const cellIndices: number[] = [];
    
    // Add collider to all cells it overlaps
    for (let cx = Math.max(0, minCX); cx <= Math.min(GRID_WIDTH - 1, maxCX); cx++) {
      for (let cz = Math.max(0, minCZ); cz <= Math.min(GRID_WIDTH - 1, maxCZ); cz++) {
        const idx = cx * GRID_WIDTH + cz;
        cellIndices.push(idx);
        this.cells[idx].push(collider);
      }
    }
    
    this.colliderCellIndices.set(collider, cellIndices);
    this.colliderGeneration.set(collider, 0); // Initialize generation
  }
  
  /**
   * Remove a collider from the grid
   */
  remove(collider: THREE.Box3): void {
    const cellIndices = this.colliderCellIndices.get(collider);
    if (!cellIndices) return;
    
    for (const idx of cellIndices) {
      const cell = this.cells[idx];
      const pos = cell.indexOf(collider);
      if (pos !== -1) {
        // Swap with last and pop (faster than splice)
        cell[pos] = cell[cell.length - 1];
        cell.pop();
      }
    }
    
    this.colliderCellIndices.delete(collider);
    this.colliderGeneration.delete(collider);
  }
  
  /**
   * Clear all colliders from the grid
   */
  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].length = 0; // Clear without reallocating
    }
    this.colliderCellIndices.clear();
    this.colliderGeneration.clear();
  }
  
  /**
   * Get all colliders near a position - ZERO ALLOCATIONS
   * Uses generation counter for O(1) deduplication
   * Returns count and fills pre-allocated array
   * Caller must use: for (let i = 0; i < count; i++) { result[i] }
   */
  getNearby(x: number, z: number, radius: number = 2): { result: THREE.Box3[], count: number } {
    // Increment generation for this query - any collider with this gen is already added
    this.currentGeneration++;
    this.nearbyCount = 0;
    
    // Calculate cell range to check
    const minCX = Math.floor((x - radius) / CELL_SIZE) + GRID_OFFSET;
    const maxCX = Math.floor((x + radius) / CELL_SIZE) + GRID_OFFSET;
    const minCZ = Math.floor((z - radius) / CELL_SIZE) + GRID_OFFSET;
    const maxCZ = Math.floor((z + radius) / CELL_SIZE) + GRID_OFFSET;
    
    for (let cx = Math.max(0, minCX); cx <= Math.min(GRID_WIDTH - 1, maxCX); cx++) {
      for (let cz = Math.max(0, minCZ); cz <= Math.min(GRID_WIDTH - 1, maxCZ); cz++) {
        const cell = this.cells[cx * GRID_WIDTH + cz];
        
        for (let i = 0; i < cell.length; i++) {
          const collider = cell[i];
          
          // O(1) deduplication using generation counter
          if (this.colliderGeneration.get(collider) === this.currentGeneration) {
            continue; // Already added in this query
          }
          
          // Mark as added for this generation
          this.colliderGeneration.set(collider, this.currentGeneration);
          
          if (this.nearbyCount < MAX_NEARBY_RESULTS) {
            this.nearbyResult[this.nearbyCount++] = collider;
          }
        }
      }
    }
    
    return { result: this.nearbyResult, count: this.nearbyCount };
  }
  
  get size(): number {
    return this.colliderCellIndices.size;
  }
}

// Singleton instance for the game
export const collisionGrid = new SpatialHashGrid();
