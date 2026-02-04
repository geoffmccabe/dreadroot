# Block/Chunk Verification Fix Plan

## Problem Summary

Trees are missing blocks that exist in blueprints. Root causes identified:

1. **Silent truncation**: `MAX_TOTAL_BLOCKS = 50000` stops fetching mid-stream, partial chunks marked as "loaded"
2. **No init gate**: `initializeForWorld()` completes even with failed/partial chunks
3. **No count verification**: `count: 'exact'` is requested but never checked
4. **Cache trusted blindly**: No integrity check on cached chunk data

---

## Phase 1: Fix Silent Truncation (Critical Bug)

**Goal**: Never accept a partial fetch as success.

**File**: `src/hooks/useChunkLoader.ts`

### 1.1 Use the count we already request

Current code requests `count: 'exact'` but ignores it. Fix:

```typescript
// In loadSpecificChunks(), after pagination loop:
const { count: totalServerCount } = await supabase
  .from('placed_blocks')
  .select('*', { count: 'exact', head: true })
  .eq('world_id', worldId)
  .gte('chunk_x', minChunkX)
  .lte('chunk_x', maxChunkX)
  .gte('chunk_z', minChunkZ)
  .lte('chunk_z', maxChunkZ);

if (totalServerCount !== null && allBlocks.length < totalServerCount) {
  console.error(`[ChunkLoader] TRUNCATION DETECTED: fetched ${allBlocks.length} of ${totalServerCount} blocks`);
  // Mark ALL chunks in this batch as failed - do not cache partials
  for (const chunkKey of chunkKeys) {
    failedChunksRef.current.set(chunkKey, { attempts: 0, lastAttempt: 0 });
  }
  return; // Do not emit partial data
}
```

### 1.2 Fetch per-chunk instead of bounding box

The bounding box approach is the root cause. Change to per-chunk fetches:

```typescript
// Instead of one big bounding box query:
for (const chunkKey of chunkKeys) {
  const { chunkX, chunkZ } = parseChunkKey(chunkKey);
  const { data, count } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('world_id', worldId)
    .eq('chunk_x', chunkX)
    .eq('chunk_z', chunkZ);

  if (count !== null && data && data.length === count) {
    // Verified complete - safe to cache and emit
  } else {
    // Mark failed for retry
  }
}
```

**Performance note**: This adds more queries but each is small and verifiable. Use concurrency limit (e.g., 4 parallel fetches) to avoid overwhelming the connection.

---

## Phase 2: Init Barrier (Must-Have)

**Goal**: Init overlay stays until all required chunks are verified.

**File**: `src/hooks/useChunkLoader.ts`

### 2.1 Track required vs verified chunks

```typescript
const requiredChunksRef = useRef<Set<string>>(new Set());
const verifiedChunksRef = useRef<Set<string>>(new Set());

// In initializeForWorld():
// 1. Build required set
const requiredKeys = getVisibleChunkKeys(startX, startZ, LOAD_RADIUS);
requiredChunksRef.current = new Set(requiredKeys);

// 2. After each ring load, update verified set
// 3. Only complete init when:
const allVerified = [...requiredChunksRef.current].every(
  key => verifiedChunksRef.current.has(key)
);
const noFailures = failedChunksRef.current.size === 0 ||
  ![...failedChunksRef.current.keys()].some(k => requiredChunksRef.current.has(k));

if (allVerified && noFailures) {
  initialLoadDone.current = true;
  setIsLoading(false);
}
```

### 2.2 Retry failed required chunks before completing

```typescript
// After ring loading, before completing:
const failedRequired = [...failedChunksRef.current.keys()]
  .filter(k => requiredChunksRef.current.has(k));

if (failedRequired.length > 0) {
  console.log(`[Init] Retrying ${failedRequired.length} failed required chunks`);
  await retryFailedChunks(failedRequired);
}

// Re-check after retry
const stillFailed = [...failedChunksRef.current.keys()]
  .filter(k => requiredChunksRef.current.has(k));

if (stillFailed.length > 0) {
  console.error(`[Init] FATAL: ${stillFailed.length} required chunks could not be loaded`);
  // Show error to user, don't silently proceed with holes
}
```

---

## Phase 3: Block Count Verification (Quick Win)

**Goal**: Detect missing blocks without expensive hashes.

### 3.1 Add expected_count to chunk data

**Database**: Add column to track expected block counts per tree per chunk.

```sql
-- New table or add to chunk_versions
CREATE TABLE IF NOT EXISTS chunk_block_counts (
  world_id UUID NOT NULL,
  chunk_key TEXT NOT NULL,
  expected_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (world_id, chunk_key)
);
```

### 3.2 Verify count after load

```typescript
// After loading chunk:
const expectedCount = await getExpectedChunkCount(worldId, chunkKey);
if (expectedCount !== null && blocks.length !== expectedCount) {
  console.warn(`[Verify] Chunk ${chunkKey}: loaded ${blocks.length}, expected ${expectedCount}`);
  // Queue for repair, don't mark as verified
}
```

### 3.3 Blueprint count for trees

When tree is planted, store per-chunk block counts:

```typescript
// In tree planting:
const chunkCounts = new Map<string, number>();
for (const block of blueprintBlocks) {
  const chunkKey = getChunkKey(block.x, block.z);
  chunkCounts.set(chunkKey, (chunkCounts.get(chunkKey) || 0) + 1);
}
// Store in chunk_block_counts table
```

---

## Phase 4: Cache Integrity (Optional, AAA-grade)

**Goal**: Detect IndexedDB corruption.

### 4.1 Store count with cached chunk

```typescript
// In storeChunk():
await blockDB.chunks.put({
  chunkKey,
  worldId,
  blocks,
  version,
  blockCount: blocks.length,  // NEW
  lastUpdated: Date.now()
});

// In loadChunk():
const cached = await blockDB.chunks.get(chunkKey);
if (cached && cached.blocks.length !== cached.blockCount) {
  console.warn(`[Cache] Integrity mismatch for ${chunkKey}, invalidating`);
  await blockDB.chunks.delete(chunkKey);
  return null;
}
```

### 4.2 Optional: Add xxHash for full integrity

Only if count verification proves insufficient. xxHash is fast (~3GB/s) and would catch any corruption.

---

## Implementation Priority

| Phase | Effort | Impact | Do First? |
|-------|--------|--------|-----------|
| 1.1 Check count | 1 hour | High | YES |
| 1.2 Per-chunk fetch | 2 hours | High | YES |
| 2.1 Track verified | 1 hour | High | YES |
| 2.2 Retry before complete | 1 hour | High | YES |
| 3.1 DB schema | 30 min | Medium | After 1-2 |
| 3.2 Count verify | 1 hour | Medium | After 3.1 |
| 3.3 Blueprint counts | 2 hours | Medium | After 3.2 |
| 4.1 Cache count | 1 hour | Low | Optional |
| 4.2 xxHash | 3 hours | Low | Optional |

---

## What NOT To Do

1. **Don't add full hashing yet** - Count verification catches 95% of issues
2. **Don't refactor the whole cache system** - Fix the specific bugs first
3. **Don't make `refreshLoadedChunks()` the repair mechanism** - It's too slow
4. **Don't remove `MAX_TOTAL_BLOCKS`** - Keep as safety net, but detect when hit

---

## Success Criteria

After Phase 1-2:
- [ ] Init overlay never dismisses with missing required chunks
- [ ] Console logs any truncation immediately
- [ ] Failed chunks are retried before init completes

After Phase 3:
- [ ] Trees with 10,000 blueprint blocks have 10,000 rendered blocks
- [ ] Count mismatches logged and repaired automatically

---

## Files To Modify

| File | Changes |
|------|---------|
| `src/hooks/useChunkLoader.ts` | Phases 1, 2 (main work) |
| `src/hooks/useIndexedDB.ts` | Phase 4.1 (optional) |
| `supabase/migrations/` | Phase 3.1 (new table) |
| `src/features/trees/hooks/useSeedPlanting.ts` | Phase 3.3 (store counts) |
