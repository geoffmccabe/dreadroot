import * as THREE from 'three';
import { diagnostics } from './diagnosticsLogger';

// Smaller cell size = fewer colliders per cell = faster iteration
const CELL_SIZE = 2;
const MAX_NEARBY_RESULTS = 128;

// ── Voxel-field block collision ───────────────────────────────────────────
// Static 1×1×1 world blocks (placed + tree) are NOT stored as Box3 objects
// in the spatial hash anymore (240k+ Box3 + hash cell arrays + insert/remove
// churn was the ~1GB heap + multi-second GC freeze). Instead they live as
// integer voxel coords in a column index (xz -> Set<y>). Queries materialize
// a Box3 only for voxels actually returned, cached with STABLE identity
// (never mutated after creation, freed when the block unloads) so any
// consumer holding a collider reference within a frame stays correct.
// Same proven scheme as the codebase's numPosKey: coords in
// [-COORD_OFFSET, COORD_OFFSET-1] per axis. Keys stay well under
// Number.MAX_SAFE_INTEGER (current max key ≈ 2^48, safe limit ≈ 2^53).
//
// Exported as the canonical encoding so every consumer (chunk loader,
// shnake AI, fade renderer, instanced atlas) uses the same formula.
// Pre-refactor 2026-May-29 these constants were re-inlined in 5 separate
// files; Track 7 of the L123 plan (coord-scale lift) only touches this
// file now.
//
// Track 7 safety contract: lifting COORD_OFFSET past ~100,000 would push
// the max key past Number.MAX_SAFE_INTEGER. At that point switch to
// Morton encoding (NEVER BigInt or strings — see L123 plan perf trap #3).
// Strides are DERIVED from COORD_OFFSET to enforce that they stay in
// lockstep on any future change.
export const COORD_OFFSET = 32768;
const COORD_RANGE = COORD_OFFSET * 2;                       // 65536
export const NUMPOSKEY_Y_STRIDE = COORD_RANGE;              // 65536
export const NUMPOSKEY_X_STRIDE = COORD_RANGE * COORD_RANGE; // 4_294_967_296

export const xzPosKey = (x: number, z: number): number =>
  (Math.floor(x) + COORD_OFFSET) * NUMPOSKEY_Y_STRIDE + (Math.floor(z) + COORD_OFFSET);
export const numPosKey = (x: number, y: number, z: number): number =>
  (Math.floor(x) + COORD_OFFSET) * NUMPOSKEY_X_STRIDE +
  (Math.floor(y) + COORD_OFFSET) * NUMPOSKEY_Y_STRIDE +
  (Math.floor(z) + COORD_OFFSET);

// NOTE: Cache variables are now PER-INSTANCE (see private fields in class)
// This is critical when using multiple grids to prevent cross-grid cache pollution.

interface SpatialHashGridOptions {
  name?: string;
  emitClearEvent?: boolean;
  clearEventName?: string;
}

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
  
  // Generation counter for cache invalidation - increments ONLY on mutations (insert/remove/update/clear)
  private generation = 1;
  
  // Per-query stamp for deduplication (avoids Set allocation per query)
  private _queryStamp = 1;
  
  // Pre-allocated result array for zero-allocation queries
  public nearbyResult: THREE.Box3[] = new Array(MAX_NEARBY_RESULTS);
  
  // Per-instance frame-local cache for nearby query results
  private _cachedQueryX = NaN;
  private _cachedQueryZ = NaN;
  private _cachedQueryMinY = NaN;
  private _cachedQueryMaxY = NaN;
  private _cachedQueryCount = 0;
  private _cachedQueryGeneration = 0;

  // Voxel-field block store: xz column key -> Set of occupied integer y's.
  private voxelCols: Map<number, Set<number>> = new Map();
  // Lazy, stable Box3 per occupied voxel (created on first query, freed on
  // removeVoxel/clear). Stable identity = safe for ref-holding consumers.
  private voxelBoxes: Map<number, THREE.Box3> = new Map();
  private _voxelCount = 0;

  constructor(private opts?: SpatialHashGridOptions) {}
  
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
    (collider as any).__q = 0; // Query stamp for dedup
    
    // Increment generation to invalidate caches
    this.generation++;
    this.invalidateCache();
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
    
    // Increment generation to invalidate caches
    this.generation++;
    this.invalidateCache();
  }
  
  /**
   * Update a collider's position in the grid.
   * OPTIMIZATION: Only reinserts when cell occupancy changes.
   * Use this instead of remove+insert when moving a collider.
   */
  update(collider: THREE.Box3): void {
    const old = this.colliderCells.get(collider);
    if (!old) {
      this.insert(collider);
      return;
    }
    
    const minCellX = this.cellCoord(collider.min.x);
    const maxCellX = this.cellCoord(collider.max.x);
    const minCellZ = this.cellCoord(collider.min.z);
    const maxCellZ = this.cellCoord(collider.max.z);
    
    // Fast path: single-cell occupancy unchanged (common for 0.5m blocks with CELL_SIZE=2)
    if (
      old.length === 2 &&
      old[0] === minCellX &&
      old[1] === minCellZ &&
      minCellX === maxCellX &&
      minCellZ === maxCellZ
    ) {
      // Bounds changed but cell didn't - still invalidate cache
      this.generation++;
      this.invalidateCache();
      return;
    }
    
    // Otherwise, reinsert (remove+insert already handle generation/cache)
    this.remove(collider);
    this.insert(collider);
  }
  
  /**
   * Remove a collider by its block position (x, y, z)
   * Searches nearby colliders and removes the one containing this position
   */
  removeByPosition(x: number, y: number, z: number): boolean {
    // Blocks are voxels now — remove directly if present.
    if (this.hasVoxel(x, y, z)) {
      this.removeVoxel(x, y, z);
      return true;
    }
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
    const name = this.opts?.name ?? 'CollisionGrid';
    console.log(`[${name}] Clearing ${this.colliderCells.size} colliders`);
    this.cells.clear();
    this.colliderCells.clear();
    this.voxelCols.clear();
    this.voxelBoxes.clear();
    this._voxelCount = 0;
    this.generation++;
    this.invalidateCache();

    // Only emit clear event if configured (WorldGrid emits, EntityGrid does not)
    if (this.opts?.emitClearEvent && typeof window !== 'undefined') {
      const evName = this.opts?.clearEventName ?? 'collisionGridCleared';
      try {
        window.dispatchEvent(new Event(evName));
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
    const name = this.opts?.name ?? 'CollisionGrid';
    console.log(`[${name}] ${count} colliders near (${x.toFixed(1)}, ${z.toFixed(1)}):`);
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
    // Use query stamp for dedup (does NOT increment generation - that's for mutations only)
    const stamp = ++this._queryStamp;
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
          if (collider.__q === stamp) continue;
          collider.__q = stamp;
          
          this.nearbyResult[count++] = collider;
          // Early exit when result buffer is full
          if (count >= MAX_NEARBY_RESULTS) return count;
        }
      }
    }
    
    count = this.collectVoxels(x, z, radius, -Infinity, Infinity, count);
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
    // Check if we can reuse cached results (same position, same Y range, no mutations since)
    // Round to 0.1 precision to catch nearly-identical queries
    const qx = Math.round(x * 10);
    const qz = Math.round(z * 10);
    const qMinY = Math.round(minY * 10);
    const qMaxY = Math.round(maxY * 10);
    
    // Cache check BEFORE any modifications - generation only changes on mutations
    if (
      qx === this._cachedQueryX &&
      qz === this._cachedQueryZ &&
      qMinY === this._cachedQueryMinY &&
      qMaxY === this._cachedQueryMaxY &&
      this._cachedQueryGeneration === this.generation
    ) {
      // Cache hit - return previously computed count (nearbyResult already populated)
      diagnostics.gridCacheHits++;
      return this._cachedQueryCount;
    }
    
    // Cache miss
    diagnostics.gridCacheMisses++;
    
    // Use query stamp for dedup (does NOT increment generation - that's for mutations only)
    const stamp = ++this._queryStamp;
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
          
          if (collider.__q === stamp) continue;
          collider.__q = stamp;
          
          // Vertical filter FIRST (cheap) — prevents huge candidate sets
          if (collider.max.y < minY || collider.min.y > maxY) continue;
          
          this.nearbyResult[count++] = collider;
          // Early exit when result buffer is full
          if (count >= MAX_NEARBY_RESULTS) {
            // Still cache even on early exit
            this._cachedQueryX = qx;
            this._cachedQueryZ = qz;
            this._cachedQueryMinY = qMinY;
            this._cachedQueryMaxY = qMaxY;
            this._cachedQueryCount = count;
            this._cachedQueryGeneration = this.generation;
            return count;
          }
        }
      }
    }
    
    // Static world blocks live in the voxel field, not the hash.
    count = this.collectVoxels(x, z, radius, minY, maxY, count);

    // Cache the results for subsequent queries at same position
    this._cachedQueryX = qx;
    this._cachedQueryZ = qz;
    this._cachedQueryMinY = qMinY;
    this._cachedQueryMaxY = qMaxY;
    this._cachedQueryCount = count;
    this._cachedQueryGeneration = this.generation;

    return count;
  }
  
  /**
   * Invalidate frame cache - call at start of physics frame
   * to ensure fresh queries after position changes
   */
  invalidateCache(): void {
    this._cachedQueryX = NaN;
    this._cachedQueryZ = NaN;
    this._cachedQueryMinY = NaN;
    this._cachedQueryMaxY = NaN;
    this._cachedQueryGeneration = 0;
    this._cachedQueryCount = 0;
  }
  
  // ── Voxel-field block API (used by the chunk loader instead of per-block
  //    Box3 + insert/remove). Cheap: a Set entry, no Box3, no hash cells. ──
  addVoxel(x: number, y: number, z: number): void {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const ck = xzPosKey(fx, fz);
    let s = this.voxelCols.get(ck);
    if (!s) { s = new Set(); this.voxelCols.set(ck, s); }
    if (!s.has(fy)) {
      s.add(fy);
      this._voxelCount++;
      this.generation++;
      this.invalidateCache();
    }
  }

  removeVoxel(x: number, y: number, z: number): void {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const ck = xzPosKey(fx, fz);
    const s = this.voxelCols.get(ck);
    if (s && s.has(fy)) {
      s.delete(fy);
      if (s.size === 0) this.voxelCols.delete(ck);
      this.voxelBoxes.delete(numPosKey(fx, fy, fz)); // free the lazy box
      this._voxelCount--;
      this.generation++;
      this.invalidateCache();
    }
  }

  /**
   * Batch-remove many voxels with a SINGLE generation bump + cache
   * invalidation at the end. Used during chunk eviction where 300+
   * blocks get removed in one tick — per-block generation bumps were
   * causing the spatial-grid query cache to thrash and tanking FPS
   * during chunk-boundary crossings.
   */
  removeVoxelsBatch(positions: ReadonlyArray<{ position_x: number; position_y: number; position_z: number }>): void {
    let actuallyRemoved = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const fx = Math.floor(p.position_x);
      const fy = Math.floor(p.position_y);
      const fz = Math.floor(p.position_z);
      const ck = xzPosKey(fx, fz);
      const s = this.voxelCols.get(ck);
      if (s && s.has(fy)) {
        s.delete(fy);
        if (s.size === 0) this.voxelCols.delete(ck);
        this.voxelBoxes.delete(numPosKey(fx, fy, fz));
        this._voxelCount--;
        actuallyRemoved++;
      }
    }
    if (actuallyRemoved > 0) {
      this.generation++;
      this.invalidateCache();
    }
  }

  hasVoxel(x: number, y: number, z: number): boolean {
    return this.voxelCols.get(xzPosKey(x, z))?.has(Math.floor(y)) ?? false;
  }

  // Append occupied voxels in the query region to nearbyResult. Materializes
  // a STABLE Box3 per voxel on first touch (cached until the block unloads),
  // so consumers that hold a reference within a frame stay correct.
  private collectVoxels(
    x: number, z: number, radius: number,
    minY: number, maxY: number, count: number,
  ): number {
    if (count >= MAX_NEARBY_RESULTS || this._voxelCount === 0) return count;
    const bxMin = Math.floor(x - radius) - 1;
    const bxMax = Math.floor(x + radius) + 1;
    const bzMin = Math.floor(z - radius) - 1;
    const bzMax = Math.floor(z + radius) + 1;
    for (let bx = bxMin; bx <= bxMax; bx++) {
      for (let bz = bzMin; bz <= bzMax; bz++) {
        const col = this.voxelCols.get(xzPosKey(bx, bz));
        if (!col) continue;
        for (const by of col) {
          if (by + 1 < minY || by > maxY) continue; // vertical overlap
          const vk = numPosKey(bx, by, bz);
          let box = this.voxelBoxes.get(vk);
          if (!box) {
            box = new THREE.Box3();
            box.min.set(bx, by, bz);
            box.max.set(bx + 1, by + 1, bz + 1);
            this.voxelBoxes.set(vk, box);
          }
          this.nearbyResult[count++] = box;
          if (count >= MAX_NEARBY_RESULTS) return count;
        }
      }
    }
    return count;
  }

  get size(): number {
    return this.colliderCells.size + this._voxelCount;
  }

  has(collider: THREE.Box3): boolean {
    return this.colliderCells.has(collider);
  }
}

// World collision grid: fortress + placed blocks + trees + invisiblocks
// Emits 'collisionGridCleared' event for chunk loader reinsertion
export const worldCollisionGrid = new SpatialHashGrid({
  name: 'WorldCollisionGrid',
  emitClearEvent: true,
  clearEventName: 'collisionGridCleared',
});

// Entity collision grid: enemies (shwarms, shnakes) and later players
// Does NOT emit clear event - entities handle their own cleanup
export const entityCollisionGrid = new SpatialHashGrid({
  name: 'EntityCollisionGrid',
  emitClearEvent: false,
});

// Temporary back-compat alias (remove later after full migration)
export const collisionGrid = worldCollisionGrid;
