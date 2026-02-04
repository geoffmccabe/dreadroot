# Fortress Data Flow Architecture

## Overview

Fortress uses a **three-tier cache system** to balance performance with data consistency:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA FLOW DIAGRAM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   MEMORY (Fastest)              loadedChunksRef (useChunkLoader) │
│   ↑ ↓                           - Map<chunkKey, ChunkData>       │
│   │ │                           - visibleBlocks for rendering    │
│   │ │                           - blocks for collision           │
│   │ │                                                            │
│   INDEXEDDB (Fast)              blockDB (useIndexedDB)           │
│   ↑ ↓                           - chunks table with signature    │
│   │ │                           - Persists across page reload    │
│   │ │                                                            │
│   SUPABASE (Authoritative)      placed_blocks, chunk_versions    │
│                                 - PostgreSQL source of truth     │
│                                 - Realtime subscriptions         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tier 1: Memory (loadedChunksRef)

**Location**: `src/hooks/useChunkLoader.ts`

**Structure**:
```typescript
interface ChunkData {
  blocks: PlacedBlock[];           // All blocks (for collision)
  visibleBlocks?: PlacedBlock[];   // Surface-only (for rendering)
  loadedAt: number;                // Timestamp for eviction
  lastAccessedAt: number;          // LRU tracking
  hasOptimisticBlocks: boolean;    // Unsaved local changes
  signature: ChunkSignature;       // For change detection
}

loadedChunksRef: Map<string, ChunkData>  // "chunk_X_Z" → data
```

**Key Operations**:
- `ensureChunkLoaded()`: Load chunk from cache/DB
- `unloadChunk()`: Remove from memory, persist to IndexedDB
- `computeSurfaceVisibleBlocks()`: Cull interior blocks

**Performance Notes**:
- Accessed every frame for rendering
- Collider lookup uses `blocks`, rendering uses `visibleBlocks`
- Eviction is budgeted (10 chunks/frame max)

---

## Tier 2: IndexedDB (blockDB)

**Location**: `src/hooks/useIndexedDB.ts`

**Schema**:
```
chunks table:
  - chunkKey: string (primary key)
  - worldId: string
  - blocks: PlacedBlock[]
  - version: number
  - lastUpdated: number
  - signature: number
```

**Key Operations**:
- `storeChunk()`: Persist chunk from memory
- `loadChunk()`: Retrieve cached chunk
- `getChunkVersion()`: Check if cache is stale

**Cache Invalidation**:
```typescript
// In useChunkLoader.ts
if (cachedVersion !== serverVersion) {
  // Cache stale - fetch from Supabase
}
```

**Migration**:
```typescript
const CURRENT_CACHE_VERSION = 3;
// Bumping this clears all IndexedDB caches for all users
```

---

## Tier 3: Supabase (Source of Truth)

**Tables**:

### `placed_blocks`
| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Block identifier |
| world_id | uuid | Which world |
| position_x/y/z | integer | Block position |
| block_type | text | Type identifier |
| texture_url | text | Custom texture (user blocks) |
| branch_depth | integer | Tree generation metadata |
| created_by | uuid | User who placed |
| created_at | timestamp | When placed |
| expires_at | timestamp | For temporary blocks |

### `chunk_versions`
| Column | Type | Purpose |
|--------|------|---------|
| chunk_key | text | "chunk_X_Z" |
| world_id | uuid | Which world |
| version | integer | Incremented on any change |
| updated_at | timestamp | Last modification |

### `tree_blueprints`
| Column | Type | Purpose |
|--------|------|---------|
| tree_id | uuid | Links to planted_trees |
| blocks | jsonb | Compressed block array |
| expected_count | integer | Verification checksum |

---

## Data Flow: Block Placement

```
1. User clicks to place block
   ↓
2. usePlacedBlocksWithCache.placeBlock()
   - Generate optimistic block (local UUID)
   - Add to loadedChunksRef immediately
   - UI renders instantly
   ↓
3. Supabase insert (async)
   - Real UUID assigned
   - chunk_versions incremented
   ↓
4. IndexedDB update (on unload or idle)
```

---

## Data Flow: Initial Load

```
1. usePlacedBlocksWithCache.initializeCache()
   ↓
2. For chunks around camera start position:
   ↓
3. Check IndexedDB for cached chunk
   - If version matches server → use cache
   - If stale or missing → fetch from Supabase
   ↓
4. computeSurfaceVisibleBlocks()
   - Generate visibleBlocks for rendering
   ↓
5. Create colliders for blocks array
   ↓
6. Store in loadedChunksRef
   ↓
7. Trigger worldRevision increment
   - Downstream useMemo() recomputes
```

---

## Data Flow: Player Movement

```
1. Camera position changes
   ↓
2. CameraTrackedBlocks frame loop detects chunk boundary
   ↓
3. updatePlayerPosition() called
   ↓
4. New chunks within LOAD_RADIUS:
   - Enqueue for loading (budgeted)
   ↓
5. Old chunks beyond UNLOAD_RADIUS:
   - Enqueue for unloading (budgeted)
   - Persist to IndexedDB first
   ↓
6. visibleChunksRef updated imperatively
   ↓
7. setRenderTrigger() causes React re-render
```

---

## Data Flow: Multiplayer Sync

```
1. Another player places/removes block
   ↓
2. Supabase trigger updates chunk_versions
   ↓
3. Realtime subscription fires
   ↓
4. refetchSingleChunk() for affected chunk
   ↓
5. New blocks merged into loadedChunksRef
   ↓
6. worldRevision incremented
```

---

## Data Flow: Tree Growth

```
1. Server-side growth tick
   ↓
2. Tree blueprint decoded
   ↓
3. New blocks written to placed_blocks
   ↓
4. chunk_versions updated for all affected chunks
   ↓
5. Realtime subscription triggers client refetch
   ↓
6. Client sees tree "grow" as new chunks load
```

---

## Signature-Based Change Detection

To avoid expensive array comparisons, each chunk has a numeric signature:

```typescript
interface ChunkSignature {
  count: number;   // Block count
  xor: number;     // XOR of all block hashes
  sum: number;     // Sum of all block hashes
}
```

**Usage**:
```typescript
// In useChunkLoader.ts
if (oldSig.count === newSig.count &&
    oldSig.xor === newSig.xor &&
    oldSig.sum === newSig.sum) {
  // No change - skip expensive operations
}
```

---

## Key Files

| File | Responsibility |
|------|----------------|
| `useChunkLoader.ts` | Memory tier, loading/unloading |
| `usePlacedBlocksWithCache.ts` | Orchestrates all three tiers |
| `useIndexedDB.ts` | IndexedDB operations |
| `BlocksContext.tsx` | Exposes data to React tree |
| `CameraTrackedBlocks.tsx` | Triggers load/unload based on camera |

---

## Error Recovery

### IndexedDB Corruption
- `CURRENT_CACHE_VERSION` bump clears all client caches
- Fallback to Supabase fetch on any IndexedDB error

### Network Failure
- Optimistic blocks marked `hasOptimisticBlocks`
- Retry queue with exponential backoff
- Failed chunks tracked in `retryQueueRef`

### Version Mismatch
- Server version always wins
- Client refetches stale chunks automatically
