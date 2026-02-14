/**
 * Merged Mesh Allocator
 *
 * Manages contiguous buffer ranges for a shared InstancedMesh.
 * Each chunk gets a range [start, start+count) in the buffer.
 *
 * Free-list allocation: removed ranges are recycled for new chunks.
 * No buffer shifting needed — caller just zero-scales freed ranges.
 * Adjacent free ranges are merged to reduce fragmentation.
 * Trailing free space reclaimed to minimize mesh.count.
 */

export interface ChunkSlot {
  start: number;
  count: number;
  /** Bounding box for frustum culling */
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

interface FreeRange {
  start: number;
  count: number;
}

export class MergedMeshAllocator {
  /** Maps chunk key → slot info */
  private slots = new Map<string, ChunkSlot>();

  /** Free ranges available for reuse (sorted by start after merge) */
  private freeRanges: FreeRange[] = [];

  /** Total buffer extent (highest allocated index, including gaps) */
  private _highWaterMark = 0;

  /** Total live instances across all active chunks */
  private _liveCount = 0;

  get highWaterMark(): number { return this._highWaterMark; }
  get liveCount(): number { return this._liveCount; }
  get chunkCount(): number { return this.slots.size; }
  get wastedCount(): number { return this._highWaterMark - this._liveCount; }

  getSlot(chunkKey: string): ChunkSlot | undefined {
    return this.slots.get(chunkKey);
  }

  getAllSlots(): Map<string, ChunkSlot> {
    return this.slots;
  }

  hasChunk(chunkKey: string): boolean {
    return this.slots.has(chunkKey);
  }

  /**
   * Add a chunk's instances. Tries to reuse a free range (best-fit),
   * otherwise appends at the end. Returns the start index.
   */
  addChunk(chunkKey: string, count: number, bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): number {
    if (this.slots.has(chunkKey)) {
      throw new Error(`Chunk ${chunkKey} already allocated`);
    }

    // Best-fit search: find smallest free range that fits
    let bestIdx = -1;
    let bestWaste = Infinity;
    for (let i = 0; i < this.freeRanges.length; i++) {
      const r = this.freeRanges[i];
      if (r.count >= count) {
        const waste = r.count - count;
        if (waste < bestWaste) {
          bestIdx = i;
          bestWaste = waste;
          if (waste === 0) break; // perfect fit
        }
      }
    }

    let start: number;
    if (bestIdx >= 0) {
      const range = this.freeRanges[bestIdx];
      start = range.start;
      if (range.count === count) {
        // Perfect fit — remove the free range
        this.freeRanges.splice(bestIdx, 1);
      } else {
        // Split: use front of range, shrink remainder
        range.start += count;
        range.count -= count;
      }
    } else {
      // No suitable free range — append at end
      start = this._highWaterMark;
      this._highWaterMark += count;
    }

    this.slots.set(chunkKey, {
      start,
      count,
      minX: bbox.minX, minY: bbox.minY, minZ: bbox.minZ,
      maxX: bbox.maxX, maxY: bbox.maxY, maxZ: bbox.maxZ,
    });
    this._liveCount += count;
    return start;
  }

  /**
   * Remove a chunk. Its range becomes available for reuse.
   * Caller must zero-scale the GPU range (no buffer shifting needed).
   * Returns the removed slot info, or null if not found.
   */
  removeChunk(chunkKey: string): { start: number; count: number } | null {
    const slot = this.slots.get(chunkKey);
    if (!slot) return null;

    const { start, count } = slot;
    this.slots.delete(chunkKey);
    this._liveCount -= count;

    // Add to free list and merge adjacent ranges
    this.freeRanges.push({ start, count });
    this._mergeAdjacentFreeRanges();

    // Reclaim trailing free space to reduce mesh.count
    this._shrinkTrailingFreeSpace();

    return { start, count };
  }

  /** Merge adjacent free ranges to reduce fragmentation */
  private _mergeAdjacentFreeRanges(): void {
    if (this.freeRanges.length < 2) return;
    this.freeRanges.sort((a, b) => a.start - b.start);
    let i = 0;
    while (i < this.freeRanges.length - 1) {
      const curr = this.freeRanges[i];
      const next = this.freeRanges[i + 1];
      if (curr.start + curr.count === next.start) {
        curr.count += next.count;
        this.freeRanges.splice(i + 1, 1);
      } else {
        i++;
      }
    }
  }

  /** Reclaim free space at the end of the buffer to minimize GPU work */
  private _shrinkTrailingFreeSpace(): void {
    for (let i = this.freeRanges.length - 1; i >= 0; i--) {
      const r = this.freeRanges[i];
      if (r.start + r.count === this._highWaterMark) {
        this._highWaterMark -= r.count;
        this.freeRanges.splice(i, 1);
        break; // only one trailing range possible after merge
      }
    }
  }

  /** Clear all allocations */
  clear(): void {
    this.slots.clear();
    this.freeRanges.length = 0;
    this._highWaterMark = 0;
    this._liveCount = 0;
  }
}
