// Track 3E: shared chunk delta-event format + batcher.
//
// PURE — no React, no Three.js, no Supabase — so the future Cloudflare DO
// and the client use the EXACT same delta representation. The DO feeds raw
// block changes in and flushes batched per-chunk deltas (~every 250ms)
// before broadcast; the client applies the same batches to its collision
// grid via chunkBuilder.applyDeltaToGrid and to its render state.
//
// Coalescing: many changes to the same cell within a window collapse to the
// cell's FINAL state (add-then-remove nets to removed; remove-then-add nets
// to added). This keeps broadcasts small during bursts (tree growth, mass
// build/mine).

import type { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { numPosKey } from './voxelKey';

export interface RemovedCell {
  position_x: number;
  position_y: number;
  position_z: number;
}

/** One chunk's worth of changes since the last flush. */
export interface ChunkDeltaBatch {
  worldId: string;
  chunkX: number;
  chunkZ: number;
  added: PlacedBlock[];      // cells now solid
  removed: RemovedCell[];    // cells now empty
}

/** Chunk coordinate for a world position (matches the rest of the codebase). */
export function chunkCoordOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}

interface CellState {
  worldId: string;
  x: number;
  y: number;
  z: number;
  block: PlacedBlock | null; // non-null = present (added); null = removed
}

/**
 * Accumulates raw block changes, coalescing per cell, and flushes them as
 * batched per-chunk deltas. Stateful but pure (no I/O, no timers — the
 * caller decides when to flush, e.g. on a 250ms tick).
 */
export class ChunkDeltaBatcher {
  // key: `${worldId}|${numPosKey(x,y,z)}` -> latest state for that cell
  private cells = new Map<string, CellState>();

  private keyOf(worldId: string, x: number, y: number, z: number): string {
    return `${worldId}|${numPosKey(x, y, z)}`;
  }

  /** Record a block becoming solid (place / grow). */
  add(block: PlacedBlock): void {
    const k = this.keyOf(block.world_id as string, block.position_x, block.position_y, block.position_z);
    this.cells.set(k, {
      worldId: block.world_id as string,
      x: block.position_x, y: block.position_y, z: block.position_z,
      block,
    });
  }

  /** Record a cell becoming empty (mine / chop / eject). */
  remove(worldId: string, x: number, y: number, z: number): void {
    const k = this.keyOf(worldId, x, y, z);
    this.cells.set(k, { worldId, x, y, z, block: null });
  }

  /** Number of distinct cells changed since the last flush. */
  get size(): number {
    return this.cells.size;
  }

  /** Drop all pending changes without emitting. */
  clear(): void {
    this.cells.clear();
  }

  /** Emit the coalesced per-chunk batches and clear pending state. */
  flush(): ChunkDeltaBatch[] {
    const batches = coalesceCells(this.cells.values());
    this.cells.clear();
    return batches;
  }
}

/** Group already-coalesced cell states into per-chunk batches. */
function coalesceCells(cells: Iterable<CellState>): ChunkDeltaBatch[] {
  const byChunk = new Map<string, ChunkDeltaBatch>();
  for (const cell of cells) {
    const { cx, cz } = chunkCoordOf(cell.x, cell.z);
    const ck = `${cell.worldId}|${cx}|${cz}`;
    let batch = byChunk.get(ck);
    if (!batch) {
      batch = { worldId: cell.worldId, chunkX: cx, chunkZ: cz, added: [], removed: [] };
      byChunk.set(ck, batch);
    }
    if (cell.block) {
      batch.added.push(cell.block);
    } else {
      batch.removed.push({ position_x: cell.x, position_y: cell.y, position_z: cell.z });
    }
  }
  return Array.from(byChunk.values());
}

/**
 * One-shot pure coalesce of a raw change list into per-chunk batches.
 * Later changes to the same cell win (last-writer-wins).
 */
export function coalesceToChunkDeltas(
  added: ReadonlyArray<PlacedBlock>,
  removed: ReadonlyArray<{ worldId: string; x: number; y: number; z: number }>,
): ChunkDeltaBatch[] {
  const b = new ChunkDeltaBatcher();
  // Apply in order so later entries override earlier same-cell ones.
  for (const block of added) b.add(block);
  for (const r of removed) b.remove(r.worldId, r.x, r.y, r.z);
  return b.flush();
}
