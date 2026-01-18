import * as THREE from 'three';

const CELL_SIZE = 4;
const MAX_NEARBY_RESULTS = 256;

/**
 * Sparse, unbounded spatial hash grid.
 * - No preallocation (zero memory until colliders added)
 * - Handles any coordinate (positive or negative)
 * - getNearby returns count, caller accesses nearbyResult array
 */
class SpatialHashGrid {
  // Sparse grid: cellX -> (cellZ -> colliders[])
  private cells: Map<number, Map<number, THREE.Box3[]>> = new Map();
  
  // Track which cells each collider occupies for O(1) removal
  private colliderCells: Map<THREE.Box3, number[]> = new Map();
  
  // Generation counter for deduplication (avoids Set allocation per query)
  private generation = 1;
  
  // Pre-allocated result array for zero-allocation queries
  public nearbyResult: THREE.Box3[] = new Array(MAX_NEARBY_RESULTS);
  
  private cellCoord(v: number): number {
    return Math.floor(v / CELL_SIZE);
  }
  
  private getOrCreateCell(cellX: number, cellZ: number): THREE.Box3[] {
    let zMap = this.cells.get(cellX);
    if (!zMap) {
      zMap = new Map();
      this.cells.set(cellX, zMap);
    }
    let cell = zMap.get(cellZ);
    if (!cell) {
      cell = [];
      zMap.set(cellZ, cell);
    }
    return cell;
  }
  
  insert(collider: THREE.Box3): void {
    // Prevent duplicates
    if (this.colliderCells.has(collider)) {
      this.remove(collider);
    }
    
    const minCellX = this.cellCoord(collider.min.x);
    const maxCellX = this.cellCoord(collider.max.x);
    const minCellZ = this.cellCoord(collider.min.z);
    const maxCellZ = this.cellCoord(collider.max.z);
    
    // Debug: Log a sample of inserts
    if (Math.random() < 0.001) {
      console.log(`[Grid Insert] pos: (${collider.min.x.toFixed(1)}, ${collider.min.z.toFixed(1)}) -> cells: x[${minCellX}-${maxCellX}] z[${minCellZ}-${maxCellZ}]`);
    }
    
    const indices: number[] = [];
    
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const cell = this.getOrCreateCell(cx, cz);
        cell.push(collider);
        indices.push(cx, cz); // Store as pairs
      }
    }
    
    this.colliderCells.set(collider, indices);
    (collider as any).__gen = 0;
  }
  
  remove(collider: THREE.Box3): void {
    const indices = this.colliderCells.get(collider);
    if (!indices) return;
    
    for (let i = 0; i < indices.length; i += 2) {
      const cellX = indices[i];
      const cellZ = indices[i + 1];
      
      const zMap = this.cells.get(cellX);
      const cell = zMap?.get(cellZ);
      if (!cell) continue;
      
      const idx = cell.indexOf(collider);
      if (idx !== -1) {
        // Swap with last and pop (faster than splice)
        cell[idx] = cell[cell.length - 1];
        cell.pop();
      }
      
      // Clean up empty cells to keep Map small
      if (cell.length === 0) {
        zMap!.delete(cellZ);
        if (zMap!.size === 0) this.cells.delete(cellX);
      }
    }
    
    this.colliderCells.delete(collider);
  }
  
  clear(): void {
    this.cells.clear();
    this.colliderCells.clear();
    this.generation++;
  }
  
  /**
   * Get nearby colliders - ZERO ALLOCATIONS
   * Returns count; caller reads grid.nearbyResult[0..count-1]
   */
  getNearby(x: number, z: number, radius: number = 2): number {
    const gen = ++this.generation;
    let count = 0;
    
    const minCX = this.cellCoord(x - radius);
    const maxCX = this.cellCoord(x + radius);
    const minCZ = this.cellCoord(z - radius);
    const maxCZ = this.cellCoord(z + radius);
    
    // Debug: Log what cells we're checking and what cells exist
    if (Math.random() < 0.002) {
      const existingCells: string[] = [];
      for (const [cx, zMap] of this.cells.entries()) {
        for (const cz of zMap.keys()) {
          existingCells.push(`(${cx},${cz})`);
          if (existingCells.length > 10) break;
        }
        if (existingCells.length > 10) break;
      }
      console.log(`[Grid] Query cells: x[${minCX}-${maxCX}] z[${minCZ}-${maxCZ}], some existing: ${existingCells.join(',')}`);
    }
    
    for (let cx = minCX; cx <= maxCX; cx++) {
      const zMap = this.cells.get(cx);
      if (!zMap) continue;
      
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const cell = zMap.get(cz);
        if (!cell) continue;
        
        for (let i = 0; i < cell.length; i++) {
          const collider = cell[i] as any;
          if (collider.__gen === gen) continue;
          collider.__gen = gen;
          
          if (count < MAX_NEARBY_RESULTS) {
            this.nearbyResult[count++] = collider;
          }
        }
      }
    }
    
    return count;
  }
  
  get size(): number {
    return this.colliderCells.size;
  }
  
  has(collider: THREE.Box3): boolean {
    return this.colliderCells.has(collider);
  }
}

export const collisionGrid = new SpatialHashGrid();
