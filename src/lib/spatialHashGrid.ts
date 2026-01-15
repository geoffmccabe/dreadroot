import * as THREE from 'three';

/**
 * Spatial Hash Grid for O(1) collision lookups
 * Divides the world into a grid of cells and stores which colliders are in each cell
 */
export class SpatialHashGrid {
  private cellSize: number;
  private cells: Map<string, THREE.Box3[]>;
  private colliderCells: Map<THREE.Box3, string[]>; // Track which cells each collider is in
  
  constructor(cellSize: number = 4) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.colliderCells = new Map();
  }
  
  private getCellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }
  
  /**
   * Add a collider to the grid
   */
  insert(collider: THREE.Box3): void {
    const minCellX = Math.floor(collider.min.x / this.cellSize);
    const maxCellX = Math.floor(collider.max.x / this.cellSize);
    const minCellZ = Math.floor(collider.min.z / this.cellSize);
    const maxCellZ = Math.floor(collider.max.z / this.cellSize);
    
    const cellKeys: string[] = [];
    
    // Add collider to all cells it overlaps
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const key = `${cx},${cz}`;
        cellKeys.push(key);
        
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(collider);
      }
    }
    
    this.colliderCells.set(collider, cellKeys);
  }
  
  /**
   * Remove a collider from the grid
   */
  remove(collider: THREE.Box3): void {
    const cellKeys = this.colliderCells.get(collider);
    if (!cellKeys) return;
    
    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (cell) {
        const idx = cell.indexOf(collider);
        if (idx !== -1) {
          cell.splice(idx, 1);
        }
        if (cell.length === 0) {
          this.cells.delete(key);
        }
      }
    }
    
    this.colliderCells.delete(collider);
  }
  
  /**
   * Clear all colliders from the grid
   */
  clear(): void {
    this.cells.clear();
    this.colliderCells.clear();
  }
  
  /**
   * Get all colliders that might overlap with a position (within search radius)
   * Returns a Set to avoid duplicates when colliders span multiple cells
   */
  getNearby(x: number, z: number, radius: number = 2): Set<THREE.Box3> {
    const result = new Set<THREE.Box3>();
    
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellZ = Math.floor((z - radius) / this.cellSize);
    const maxCellZ = Math.floor((z + radius) / this.cellSize);
    
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const cell = this.cells.get(`${cx},${cz}`);
        if (cell) {
          for (const collider of cell) {
            result.add(collider);
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Rebuild the entire grid from a list of colliders
   */
  rebuild(colliders: THREE.Box3[]): void {
    this.clear();
    for (const collider of colliders) {
      this.insert(collider);
    }
  }
  
  get size(): number {
    return this.colliderCells.size;
  }
}

// Singleton instance for the game
export const collisionGrid = new SpatialHashGrid(4);
