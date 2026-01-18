import * as THREE from 'three';

// Smaller cell size = fewer colliders per cell = faster iteration
const CELL_SIZE = 2;
const MAX_NEARBY_RESULTS = 128;

// Frame-local cache for nearby query results (avoids re-querying same position)
let _cachedQueryX = NaN;
let _cachedQueryZ = NaN;
let _cachedQueryMinY = NaN;
let _cachedQueryMaxY = NaN;
let _cachedQueryCount = 0;
let _cachedQueryGeneration = 0;

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
  
  /**
   * Remove a collider by its block position (x, y, z)
   * Searches nearby colliders and removes the one containing this position
   */
  removeByPosition(x: number, y: number, z: number): boolean {
    const count = this.getNearby(x, z, 1);
    for (let i = 0; i < count; i++) {
      const collider = this.nearbyResult[i];
      // Check if this collider contains the block position
      if (
        collider.min.x <= x && x < collider.max.x &&
        collider.min.y <= y && y < collider.max.y &&
        collider.min.z <= z && z < collider.max.z
      ) {
        this.remove(collider);
        return true;
      }
    }
    return false;
  }
  
  clear(): void {
    console.log(`[CollisionGrid] Clearing ${this.colliderCells.size} colliders`);
    this.cells.clear();
    this.colliderCells.clear();
    this.generation++;

    // Notify listeners (e.g., chunk loader) to reinsert cached colliders.
    // This prevents "no collision" states after an emergency clear or hot reload.
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new Event('collisionGridCleared'));
      } catch {
        // ignore
      }
    }
  }
  
  /**
   * Debug: Log info about colliders near a position
   */
  debugNearby(x: number, z: number, radius: number = 5): void {
    const count = this.getNearby(x, z, radius);
    console.log(`[CollisionGrid] ${count} colliders near (${x.toFixed(1)}, ${z.toFixed(1)}):`);
    for (let i = 0; i < Math.min(count, 10); i++) {
      const c = this.nearbyResult[i];
      console.log(`  ${i}: (${c.min.x.toFixed(1)},${c.min.y.toFixed(1)},${c.min.z.toFixed(1)}) to (${c.max.x.toFixed(1)},${c.max.y.toFixed(1)},${c.max.z.toFixed(1)})`);
    }
    if (count > 10) console.log(`  ... and ${count - 10} more`);
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
  
  /**
   * Get nearby colliders with Y-filtering - ZERO ALLOCATIONS
   * Filters colliders by vertical overlap before returning.
   * Critical for voxel worlds where 2D (XZ) hash can return huge vertical stacks.
   * Mimics Minecraft-style collision gathering: only consider shapes intersecting the entity AABB region.
   * 
   * OPTIMIZATION: Caches query results for same position within a frame.
   * Multiple collision checks (X, Y, Z axes) at same position will reuse cached results.
   */
  getNearbyFiltered(
    x: number,
    z: number,
    radius: number,
    minY: number,
    maxY: number
  ): number {
    // Check if we can reuse cached results (same position, same Y range, same frame)
    // Round to 0.1 precision to catch nearly-identical queries
    const qx = Math.round(x * 10);
    const qz = Math.round(z * 10);
    const qMinY = Math.round(minY * 10);
    const qMaxY = Math.round(maxY * 10);
    
    if (
      qx === _cachedQueryX &&
      qz === _cachedQueryZ &&
      qMinY === _cachedQueryMinY &&
      qMaxY === _cachedQueryMaxY &&
      _cachedQueryGeneration === this.generation
    ) {
      // Cache hit - return previously computed count (nearbyResult already populated)
      return _cachedQueryCount;
    }
    
    const gen = ++this.generation;
    let count = 0;
    
    const minCX = this.cellCoord(x - radius);
    const maxCX = this.cellCoord(x + radius);
    const minCZ = this.cellCoord(z - radius);
    const maxCZ = this.cellCoord(z + radius);
    
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
          
          // Vertical filter FIRST (cheap) — prevents huge candidate sets
          if (collider.max.y < minY || collider.min.y > maxY) continue;
          
          if (count < MAX_NEARBY_RESULTS) {
            this.nearbyResult[count++] = collider;
          }
        }
      }
    }
    
    // Cache the results for subsequent queries at same position
    _cachedQueryX = qx;
    _cachedQueryZ = qz;
    _cachedQueryMinY = qMinY;
    _cachedQueryMaxY = qMaxY;
    _cachedQueryCount = count;
    _cachedQueryGeneration = this.generation;
    
    return count;
  }
  
  /**
   * Invalidate frame cache - call at start of physics frame
   * to ensure fresh queries after position changes
   */
  invalidateCache(): void {
    _cachedQueryX = NaN;
    _cachedQueryZ = NaN;
  }
  
  get size(): number {
    return this.colliderCells.size;
  }
  
  has(collider: THREE.Box3): boolean {
    return this.colliderCells.has(collider);
  }
}

export const collisionGrid = new SpatialHashGrid();
