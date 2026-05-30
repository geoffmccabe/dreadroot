// Pure chunk-fetch helpers — extracted from useChunkLoader.ts so the L2
// Durable Object can run the same queries against Supabase from plain
// Node (no React, no THREE, no browser APIs).
//
// What lives here:
//   • fetchChunksByRadius — bounding-box paginated SELECT (initial load)
//   • fetchChunksBatched  — fetch_chunks_batch RPC + per-chunk fallback
//
// What does NOT live here:
//   • Retry-failed-chunks tracking, IndexedDB cache lookups, collider
//     side-effects — those stay in useChunkLoader.
//
// L2 DO contract: pass in a SupabaseClient<Database>; the function does
// no I/O outside that client + a few console.log lines. Same code runs
// in browser and Node.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { PlacedBlock } from '@/types/blocks';

type Sb = SupabaseClient<Database>;

// ── Tunables ────────────────────────────────────────────────────────

export interface ChunkFetchTunables {
  /** Rows per Supabase page request. Default 1000. */
  pageSize?: number;
  /** Max blocks before we hit the safety limit. Default 50_000. */
  maxTotalBlocks?: number;
  /** Total retries for the entire bounded fetch. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff (doubled each attempt). */
  retryBaseDelayMs?: number;
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_TOTAL_BLOCKS = 50_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 2000;

export interface ChunkFetchBatchedTunables {
  /** Chunks per fetch_chunks_batch RPC call. Default 50. */
  rpcBatchSize?: number;
  /** Concurrent per-chunk queries in fallback path. Default 10. */
  parallelLimit?: number;
  /** Rows per Supabase page request in fallback path. Default 1000. */
  pageSize?: number;
  /** Safety cap per chunk in the fallback path. Default 10_000. */
  maxBlocksPerChunk?: number;
}

const DEFAULT_RPC_BATCH = 50;
const DEFAULT_PARALLEL = 10;
const DEFAULT_FALLBACK_PAGE_SIZE = 1000;
const DEFAULT_MAX_PER_CHUNK = 10_000;

// ── Bounded-box fetch ───────────────────────────────────────────────

export interface RadiusBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkZ: number;
  maxChunkZ: number;
}

export interface RadiusFetchResult {
  /** Blocks fetched, or null if all retry attempts failed. */
  blocks: PlacedBlock[] | null;
  /** True if pagination stopped early because we hit maxTotalBlocks. */
  hitSafetyLimit: boolean;
}

/** Paginated SELECT over a chunk bounding box with retry. Used for
 *  initial-load / radius-load. Caller decides what to do with failed
 *  chunks (retry tracking lives at the call site). */
export async function fetchChunksByRadius(
  sb: Sb,
  worldId: string,
  bounds: RadiusBounds,
  opts?: ChunkFetchTunables,
): Promise<RadiusFetchResult> {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxTotalBlocks = opts?.maxTotalBlocks ?? DEFAULT_MAX_TOTAL_BLOCKS;
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = opts?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;

  let blocks: PlacedBlock[] | null = null;
  let hitSafetyLimit = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const fetched: PlacedBlock[] = [];
    hitSafetyLimit = false;
    let offset = 0;
    let hasMore = true;
    let pageError = false;

    while (hasMore) {
      const { data, error } = await sb
        .from('placed_blocks')
        .select('*')
        .eq('world_id', worldId)
        .gte('chunk_x', bounds.minChunkX)
        .lte('chunk_x', bounds.maxChunkX)
        .gte('chunk_z', bounds.minChunkZ)
        .lte('chunk_z', bounds.maxChunkZ)
        .range(offset, offset + pageSize - 1);

      if (error) {
        console.error(`[chunkFetch] fetchChunksByRadius page failed at offset ${offset} (attempt ${attempt + 1}/${maxRetries}):`, error.message);
        pageError = true;
        break;
      }

      if (data && data.length > 0) {
        fetched.push(...(data as PlacedBlock[]));
        offset += data.length;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }

      if (offset >= maxTotalBlocks) {
        console.warn(`[chunkFetch] fetchChunksByRadius hit ${maxTotalBlocks} safety limit`);
        hitSafetyLimit = true;
        hasMore = false;
      }
    }

    if (!pageError) {
      blocks = fetched;
      break;
    }

    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, retryBaseMs * (2 ** attempt)));
    }
  }

  return { blocks, hitSafetyLimit };
}

// ── Batched per-chunk fetch ─────────────────────────────────────────

export interface BatchedFetchResult {
  blocks: PlacedBlock[];
  failedChunkCoords: Array<{ x: number; z: number }>;
  /** True if the fetch_chunks_batch RPC was unavailable and we fell
   *  back to per-chunk SELECTs. */
  usedFallback: boolean;
}

/** Fetch a SET of specific chunks via the fetch_chunks_batch RPC, with
 *  per-chunk paginated SELECT fallback if the RPC is not deployed. */
export async function fetchChunksBatched(
  sb: Sb,
  worldId: string,
  chunks: ReadonlyArray<{ x: number; z: number }>,
  opts?: ChunkFetchBatchedTunables,
): Promise<BatchedFetchResult> {
  const rpcBatchSize = opts?.rpcBatchSize ?? DEFAULT_RPC_BATCH;
  const parallelLimit = opts?.parallelLimit ?? DEFAULT_PARALLEL;
  const pageSize = opts?.pageSize ?? DEFAULT_FALLBACK_PAGE_SIZE;
  const maxBlocksPerChunk = opts?.maxBlocksPerChunk ?? DEFAULT_MAX_PER_CHUNK;

  let blocks: PlacedBlock[] = [];
  const failedChunkCoords: Array<{ x: number; z: number }> = [];
  let useRpcFallback = false;

  // Primary path: batched RPC.
  for (let i = 0; i < chunks.length; i += rpcBatchSize) {
    const batch = chunks.slice(i, i + rpcBatchSize);
    const chunkParams = batch.map(({ x, z }) => ({ x, z }));

    const { data, error } = await sb.rpc('fetch_chunks_batch', {
      p_world_id: worldId,
      p_chunks: chunkParams,
    });

    if (error) {
      // RPC not deployed yet — fall through to per-chunk SELECT.
      if (error.code === '42883' || error.message?.includes('function') || error.code === 'PGRST202') {
        console.warn('[chunkFetch] Batched RPC not available, falling back to per-chunk fetch');
        useRpcFallback = true;
        break;
      }
      console.error('[chunkFetch] Batched RPC error:', error.message);
      for (const { x, z } of batch) failedChunkCoords.push({ x, z });
      continue;
    }

    if (data && (data as any[]).length > 0) {
      // RPC returns rows without created_at/updated_at — patch defaults so
      // PlacedBlock callers don't NPE.
      const rows = data as any[];
      for (let j = 0; j < rows.length; j++) {
        rows[j].created_at = rows[j].created_at ?? '';
        rows[j].updated_at = rows[j].updated_at ?? '';
      }
      blocks = blocks.concat(rows as PlacedBlock[]);
    }
  }

  // Fallback path: per-chunk paginated SELECTs.
  if (useRpcFallback) {
    blocks = [];
    for (let i = 0; i < chunks.length; i += parallelLimit) {
      const batch = chunks.slice(i, i + parallelLimit);
      const batchPromises = batch.map(async ({ x, z }) => {
        let chunkBlocks: PlacedBlock[] = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: pageData, error: pageErr } = await sb
            .from('placed_blocks')
            .select('*')
            .eq('world_id', worldId)
            .eq('chunk_x', x)
            .eq('chunk_z', z)
            .range(offset, offset + pageSize - 1);
          if (pageErr) {
            return { x, z, blocks: null as PlacedBlock[] | null, failed: true };
          }
          if (pageData && pageData.length > 0) {
            chunkBlocks = chunkBlocks.concat(pageData as PlacedBlock[]);
            offset += pageData.length;
            hasMore = pageData.length === pageSize;
          } else {
            hasMore = false;
          }
          if (offset >= maxBlocksPerChunk) hasMore = false;
        }
        return { x, z, blocks: chunkBlocks, failed: false };
      });
      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r.failed || r.blocks === null) {
          failedChunkCoords.push({ x: r.x, z: r.z });
        } else {
          blocks = blocks.concat(r.blocks);
        }
      }
    }
  }

  return { blocks, failedChunkCoords, usedFallback: useRpcFallback };
}
