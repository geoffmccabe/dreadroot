/**
 * EnemySpatialIndex - Lightweight 2D spatial hash for enemy neighbor queries
 * 
 * Separate from collisionGrid (which stores Box3 colliders for world geometry).
 * This index stores enemy positions for efficient "nearby allies" queries.
 */

import type { EnemyEntry } from './types';

const CELL_SIZE = 16; // 16 blocks per cell (matches chunk size)

function cellKey(cellX: number, cellZ: number): string {
  return `${cellX},${cellZ}`;
}

export class EnemySpatialIndex {
  private cells: Map<string, EnemyEntry[]> = new Map();
  private enemyToCell: Map<string, string> = new Map(); // enemyId -> cellKey
  
  // Pre-allocated result array to avoid allocations
  private queryResult: EnemyEntry[] = [];
  
  /**
   * Batch update all enemy positions.
   * More efficient than individual insert/remove operations.
   */
  update(enemies: EnemyEntry[]): void {
    // Clear existing data
    this.cells.clear();
    this.enemyToCell.clear();
    
    // Insert all enemies
    for (const entry of enemies) {
      const cellX = Math.floor(entry.x / CELL_SIZE);
      const cellZ = Math.floor(entry.z / CELL_SIZE);
      const key = cellKey(cellX, cellZ);
      
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(entry);
      this.enemyToCell.set(entry.id, key);
    }
  }
  
  /**
   * Remove a single enemy (for when enemies die mid-frame).
   */
  remove(enemyId: string): void {
    const key = this.enemyToCell.get(enemyId);
    if (!key) return;
    
    const cell = this.cells.get(key);
    if (cell) {
      const idx = cell.findIndex(e => e.id === enemyId);
      if (idx !== -1) {
        // Swap-remove for O(1)
        cell[idx] = cell[cell.length - 1];
        cell.pop();
      }
    }
    this.enemyToCell.delete(enemyId);
  }
  
  /**
   * Query enemies near a position.
   * Returns internal array - do not modify!
   */
  getNearby(x: number, z: number, radius: number): readonly EnemyEntry[] {
    this.queryResult.length = 0;
    
    const radiusSq = radius * radius;
    const minCellX = Math.floor((x - radius) / CELL_SIZE);
    const maxCellX = Math.floor((x + radius) / CELL_SIZE);
    const minCellZ = Math.floor((z - radius) / CELL_SIZE);
    const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
    
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell) continue;
        
        for (const entry of cell) {
          const dx = entry.x - x;
          const dz = entry.z - z;
          if (dx * dx + dz * dz <= radiusSq) {
            this.queryResult.push(entry);
          }
        }
      }
    }
    
    return this.queryResult;
  }
  
  /**
   * Count enemies of a specific type near a position.
   * Optimized for "nearby allies" calculation.
   */
  countNearby(x: number, z: number, radius: number, type?: string): number {
    let count = 0;
    
    const radiusSq = radius * radius;
    const minCellX = Math.floor((x - radius) / CELL_SIZE);
    const maxCellX = Math.floor((x + radius) / CELL_SIZE);
    const minCellZ = Math.floor((z - radius) / CELL_SIZE);
    const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
    
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell) continue;
        
        for (const entry of cell) {
          if (type && entry.type !== type) continue;
          
          const dx = entry.x - x;
          const dz = entry.z - z;
          if (dx * dx + dz * dz <= radiusSq) {
            count++;
          }
        }
      }
    }
    
    return count;
  }
  
  /**
   * Clear all data.
   */
  clear(): void {
    this.cells.clear();
    this.enemyToCell.clear();
    this.queryResult.length = 0;
  }
  
  /**
   * Get total count of indexed enemies.
   */
  get size(): number {
    return this.enemyToCell.size;
  }
}
