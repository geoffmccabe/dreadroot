# Fortress Chunk System

## Overview

The world is divided into **chunks** - 16×16 block horizontal tiles with unlimited vertical extent. This enables:
- Efficient spatial queries
- Progressive loading as player moves
- Memory management via chunk unloading
- Multiplayer sync at chunk granularity

---

## Chunk Coordinates

```
World Position (x, z) → Chunk (chunkX, chunkZ)
chunkX = Math.floor(x / 16)
chunkZ = Math.floor(z / 16)

Chunk Key: "chunk_${chunkX}_${chunkZ}"
```

**Example**:
- Block at (35, 100, -12)
- chunkX = floor(35/16) = 2
- chunkZ = floor(-12/16) = -1
- Key: "chunk_2_-1"

---

## Loading Zones

```
              UNLOAD_RADIUS (LOAD_RADIUS + 4)
         ┌─────────────────────────────────────┐
         │                                     │
         │      LOAD_RADIUS (visual + 3)       │
         │    ┌─────────────────────────┐      │
         │    │                         │      │
         │    │   VISUAL_DISTANCE       │      │
         │    │  ┌─────────────────┐    │      │
         │    │  │                 │    │      │
         │    │  │     PLAYER      │    │      │
         │    │  │       ★        │    │      │
         │    │  │                 │    │      │
         │    │  └─────────────────┘    │      │
         │    │   (fully rendered)      │      │
         │    └─────────────────────────┘      │
         │        (fade silhouettes)           │
         └─────────────────────────────────────┘
                   (memory resident)
```

### Zone Definitions

| Zone | Radius | Behavior |
|------|--------|----------|
| Visual | User setting (default 4) | Full texture rendering |
| Fade | Visual + 1 to Visual + 3 | Grey silhouette |
| Load | Visual + 3 | Memory resident |
| Unload | Load + 4 | Eviction candidate |

### Hysteresis
The gap between LOAD_RADIUS and UNLOAD_RADIUS prevents thrashing when player oscillates on a boundary.

---

## Chunk Lifecycle

### 1. Loading
```typescript
// useChunkLoader.ts
ensureChunkLoaded(chunkX, chunkZ) {
  1. Check loadedChunksRef (already in memory?)
  2. Check IndexedDB cache (version match?)
  3. Fetch from Supabase if needed
  4. computeSurfaceVisibleBlocks() for rendering
  5. Create colliders (budgeted: 200/frame)
  6. Store in loadedChunksRef
  7. Update chunk height map
}
```

### 2. Active
- `blocks` array used for collision detection
- `visibleBlocks` array used for rendering
- `lastAccessedAt` updated on player proximity
- Signature checked against server for staleness

### 3. Unloading
```typescript
// useChunkLoader.ts
unloadChunk(chunkX, chunkZ) {
  1. Check MIN_RESIDENCY_MS (8s minimum stay)
  2. Check hasOptimisticBlocks (unsaved = pinned)
  3. Remove colliders (budgeted: 200/frame)
  4. Persist to IndexedDB if changed
  5. Remove from loadedChunksRef
  6. Clean up height map
}
```

---

## ChunkData Structure

```typescript
interface ChunkData {
  blocks: PlacedBlock[];
  // All blocks in chunk - used for:
  // - Collision detection
  // - Block removal lookup
  // - Saving to IndexedDB

  visibleBlocks?: PlacedBlock[];
  // Surface-only blocks - used for:
  // - Rendering (InstancedMesh)
  // - Reduces draw call count by 60-80%

  loadedAt: number;
  // Timestamp when chunk entered memory
  // Used for MIN_RESIDENCY_MS check

  lastAccessedAt: number;
  // LRU timestamp for eviction priority

  hasOptimisticBlocks: boolean;
  // True if unsaved user-placed blocks
  // Prevents unload until synced

  signature: ChunkSignature;
  // Numeric signature for O(1) change detection
}
```

---

## Surface Culling

**File**: `useChunkLoader.ts` → `computeSurfaceVisibleBlocks()`

Interior blocks (fully surrounded on all 6 faces) are removed from `visibleBlocks`:

```
    □ □ □
   □ ■ □     ■ = interior (culled)
    □ □ □    □ = surface (kept)
```

**Algorithm**:
1. Build 3D occupancy grid (Uint8Array, 16×16×H)
2. For each block, check 6 neighbors in grid
3. If all neighbors occupied → cull (interior)
4. Chunk edges always kept (cross-chunk neighbors unknown)

**Non-tree blocks never culled** - user-placed blocks always render.

---

## Rendering Pipeline

```
loadedChunksRef
      │
      ▼
CameraTrackedBlocks.tsx
      │
      ├─── normalEntries (within visualDistance)
      │         │
      │         ▼
      │    ChunkRenderer.tsx
      │         │
      │         ▼
      │    PlacedBlocks.tsx
      │         │
      │    ┌────┴────┐
      │    ▼         ▼
      │  Atlas    Instance
      │  Blocks   Blocks
      │    │         │
      │    ▼         ▼
      │  InstancedAtlasBlockGroup
      │  InstancedBlockGroup
      │
      └─── fadeEntries (visualDistance+1 to +3)
                │
                ▼
           FadeChunkBlocks.tsx
           (grey silhouette shader)
```

---

## Chunk Versions (Multiplayer)

**Table**: `chunk_versions`
```sql
chunk_key   │ world_id │ version │ updated_at
────────────┼──────────┼─────────┼────────────
chunk_0_0   │ abc123   │ 47      │ 2024-01-15
chunk_1_0   │ abc123   │ 12      │ 2024-01-14
```

**Flow**:
1. Block placed/removed → `placed_blocks` updated
2. Supabase trigger increments `chunk_versions.version`
3. Realtime subscription notifies all clients
4. Clients compare local version → refetch if stale

---

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useChunkLoader.ts` | Core loading/unloading logic |
| `src/lib/chunkManager.ts` | Chunk math utilities |
| `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx` | Visibility classification |
| `src/components/ChunkRenderer.tsx` | Per-chunk rendering wrapper |
| `src/lib/chunkHeightMap.ts` | Y-axis height tracking per chunk |

---

## Configuration Constants

```typescript
// useChunkLoader.ts
const CHUNK_SIZE = 16;                    // Blocks per chunk side
const DEFAULT_LOAD_RADIUS = 4;            // Chunks around player
const UNLOAD_HYSTERESIS = 4;              // Extra buffer before unload
const MIN_RESIDENCY_MS = 8000;            // 8s before eligible for unload
const COLLIDER_CREATION_BATCH = 200;      // Per frame
const COLLIDER_REMOVAL_BATCH = 200;       // Per frame
const EVICTION_BATCH_SIZE = 10;           // Chunks per eviction pass

// CameraTrackedBlocks.tsx
const FADE_EXTRA = 3;                     // Chunks beyond visual for fade
const CHUNK_UPDATE_THROTTLE = 100;        // ms between visibility updates
```

---

## Common Issues

### Chunk appears empty but colliders work
**Cause**: `visibleBlocks` is empty array `[]` but not null
**Fix**: Check `visibleBlocks?.length` not just `visibleBlocks ??`

### Stuttering at chunk boundaries
**Cause**: Too many colliders created/removed per frame
**Fix**: Reduce `COLLIDER_CREATION_BATCH` / `COLLIDER_REMOVAL_BATCH`

### Chunks unload too aggressively
**Cause**: `MIN_RESIDENCY_MS` too low or `UNLOAD_HYSTERESIS` too small
**Fix**: Increase these values

### Memory grows unbounded
**Cause**: Chunks not being evicted
**Fix**: Check `EVICTION_BATCH_SIZE` and eviction queue logic
