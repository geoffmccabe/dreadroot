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
import { resolveWorldNumber } from '@/lib/worldNumber';
import { resolveUserId } from '@/lib/playerCatalogue';

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

// Track 3D: once we learn the cached-blob RPC isn't deployed, stop retrying
// it (avoids a wasted round-trip per batch until the migration is run).
// Resets on reload, so it picks up the RPC after the SQL is applied.
let cacheRpcAvailable = true;

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

// world_number resolver lives in @/lib/worldNumber (shared with the chunk-sync hooks).

// Wire-format normalizer. The chunk-fetch RPCs may return each block either as a named object
// (legacy) or as a compact positional array [id, user_id, block_type, x, y, z, expires_at,
// texture_url] (new — drops the repeated key names + the derivable chunk_x/z). Accept either and
// produce the internal PlacedBlock shape, so the client can read the new format BEFORE the server
// switches to it (no flag-day). chunk_x/z are derived from position.
const WIRE_CHUNK_SIZE = 16;
function normalizeRpcBlock(row: any): PlacedBlock {
  if (Array.isArray(row)) {
    const px = row[3] as number, pz = row[5] as number;
    return {
      id: row[0], user_id: resolveUserId(row[1]), block_type: row[2],
      position_x: px, position_y: row[4], position_z: pz,
      expires_at: row[6] ?? null, texture_url: row[7] ?? null,
      chunk_x: Math.floor(px / WIRE_CHUNK_SIZE), chunk_z: Math.floor(pz / WIRE_CHUNK_SIZE),
      created_at: '', updated_at: '',
    } as PlacedBlock;
  }
  // Legacy named-object format: patch the fields the RPC omits; derive chunk_x/z if absent.
  row.created_at = row.created_at ?? '';
  row.updated_at = row.updated_at ?? '';
  if (row.chunk_x == null && row.position_x != null) row.chunk_x = Math.floor(row.position_x / WIRE_CHUNK_SIZE);
  if (row.chunk_z == null && row.position_z != null) row.chunk_z = Math.floor(row.position_z / WIRE_CHUNK_SIZE);
  return row as PlacedBlock;
}

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
  const worldNumber = await resolveWorldNumber(sb, worldId);

  let blocks: PlacedBlock[] | null = null;
  let hitSafetyLimit = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const fetched: PlacedBlock[] = [];
    hitSafetyLimit = false;
    let offset = 0;
    let hasMore = true;
    let pageError = false;

    while (hasMore) {
      let q: any = sb.from('placed_blocks').select('*');
      q = worldNumber != null ? q.eq('world_number', worldNumber) : q.eq('world_id', worldId);
      const { data, error } = await q
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
  const worldNumber = await resolveWorldNumber(sb, worldId);

  let blocks: PlacedBlock[] = [];
  const failedChunkCoords: Array<{ x: number; z: number }> = [];
  let useRpcFallback = false;

  // Primary path: batched RPC.
  for (let i = 0; i < chunks.length; i += rpcBatchSize) {
    const batch = chunks.slice(i, i + rpcBatchSize);
    const chunkParams = batch.map(({ x, z }) => ({ x, z }));

    // Track 3D: prefer the cached-blob RPC (skips re-scanning placed_blocks
    // for unchanged chunks). Fall back to the live aggregate RPC if the cache
    // isn't deployed yet — module flag avoids retrying it every call.
    let data: any, error: any;
    if (cacheRpcAvailable) {
      ({ data, error } = await sb.rpc('fetch_chunks_cached', {
        p_world_id: worldId,
        p_chunks: chunkParams,
      }));
      if (error) {
        // Permanently disable only when the RPC truly isn't deployed;
        // for any other error just fall back to the live aggregate for
        // this batch so loading never breaks on a cache hiccup.
        if (error.code === '42883' || error.code === 'PGRST202' || error.message?.includes('function')) {
          cacheRpcAvailable = false;
        }
        ({ data, error } = await sb.rpc('fetch_chunks_batch', {
          p_world_id: worldId,
          p_chunks: chunkParams,
        }));
      }
    } else {
      ({ data, error } = await sb.rpc('fetch_chunks_batch', {
        p_world_id: worldId,
        p_chunks: chunkParams,
      }));
    }

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
      // Normalize each block (handles both legacy named objects and the new positional arrays).
      const rows = data as any[];
      const normalized: PlacedBlock[] = new Array(rows.length);
      for (let j = 0; j < rows.length; j++) normalized[j] = normalizeRpcBlock(rows[j]);
      blocks = blocks.concat(normalized);
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
          let fq: any = sb.from('placed_blocks').select('*');
          fq = worldNumber != null ? fq.eq('world_number', worldNumber) : fq.eq('world_id', worldId);
          const { data: pageData, error: pageErr } = await fq
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
