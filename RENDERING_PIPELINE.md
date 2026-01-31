# Rendering Pipeline - Deep Dive

> **For LLM auditors**: This is the system we are actively rebuilding. Read this to understand the current architecture, what's broken, and the planned fix.

## Current Architecture (Broken)

### Data Flow: Chunk Loading to GPU

```
1. useChunkLoader.ts
   - Stores blocks in Map<string, ChunkData> keyed by "chunk_{x}_{z}"
   - Each ChunkData has: { blocks: PlacedBlock[], visibleBlocks?: PlacedBlock[], signature, ... }
   - Mutations (add/remove block) call scheduleEmit() which:
     a. Iterates ALL loaded chunks
     b. Copies ALL blocks into one flat PlacedBlock[]
     c. Calls onBlocksChanged(flatArray)

2. BlocksContext.tsx
   - Receives flat array via onBlocksChanged callback
   - Stores in React state -> triggers re-render of entire tree

3. FortressScene.CameraTrackedBlocks.tsx (lines 123-165)
   - visibleBlocks useMemo:
     a. Iterates loadedChunksRef (ALL chunks, not just visible)
     b. Deduplicates with Set<string> of block IDs (180K string insertions)
     c. Sorts by block.id.localeCompare() (O(N log N) on 180K blocks)
   - Passes flat sorted array to single <PlacedBlocks> component

4. PlacedBlocks.tsx
   - Receives flat PlacedBlock[] (all blocks in world)
   - Groups by type: tree blocks -> atlasTreeBlocks, non-tree -> grouped by block_type
   - Occlusion culls tree blocks (cullOccludedBlocks)
   - Renders ONE InstancedAtlasBlockGroup for ALL tree blocks
   - Renders ONE InstancedBlockGroup per non-tree block type

5. InstancedAtlasBlockGroup.tsx
   - Receives ALL tree blocks (~63K) as single array
   - Budgeted rebuild: processes 5000 blocks/frame within 8ms budget
   - Full rebuild takes 3-10 frames to complete
   - Uses shared texture atlas (8192x8192) with per-instance UV offsets

6. InstancedBlockGroup.tsx
   - Receives blocks of one type
   - Synchronous rebuild per block-type group
   - Individual textures (not atlas) per group
```

### Why This Is Slow

Every block change (add, remove, chunk load/unload) triggers this cascade:

| Step | Cost | Why |
|------|------|-----|
| scheduleEmit: flatten all chunks | ~3ms | Iterates 180K blocks, allocates new array |
| CameraTrackedBlocks: dedup + sort | ~15ms | Set of 180K strings + localeCompare sort |
| PlacedBlocks: grouping | ~130ms | Iterates 180K blocks, classifies each |
| InstancedAtlasBlockGroup: rebuild | ~230ms | Writes matrix + UV + color for 63K instances |
| **Total per change** | **~380ms** | **Blocks main thread, causes stutter** |

With 14 changes in a 53-second session, that's **~5.3 seconds** of main-thread blocking.

### Chunk Boundary Stalls

When the player crosses a chunk boundary:
1. New chunks load (async, fast)
2. Old chunks unload
3. `scheduleEmit()` fires -> flattens ALL chunks -> new array reference
4. Entire rendering cascade runs on ALL 180K blocks
5. **Result: 1170ms frame spike**

## Texture Atlas System

### Atlas Specifications
- **Canvas**: 8192x8192 pixels (64MB uncompressed RGBA)
- **Grid**: 32x32 = 1024 slots, each 256x256 pixels
- **Format**: CanvasTexture with LinearFilter, no mipmaps

### Slot Allocation (defined in atlasManager.ts SLOT_RANGES)
```
Slots 0-149:    Tree (30 tiers x 3 types: trunk/branch/fruit)
Slots 150-399:  Shwarm (10 tiers, animated GIFs up to 24 frames each)
Slots 400-429:  Shombie (10 tiers x 3)
Slots 430-519:  Shnake (10 tiers x 3 parts: head/body/face)
Slots 520-549:  Walapa (10 tiers x 3 parts: body/belly/eyes)
Slots 550-569:  Global (coin, cliff, grass)
Slots 570-839:  User-placed blocks (270 slots)
Slots 840-929:  Fungal tree (30 tiers x 3 types: stem/cap_top/cap_underside)
Slots 930-1023: Misc (94 slots)
```

### UV Calculation
```typescript
// atlasLookup.ts: slotIndexToUVs()
const col = slotIndex % 32;
const row = Math.floor(slotIndex / 32);
uvOffsetX = col * (1/32);
uvOffsetY = 1 - (row + 1) * (1/32);  // Y-flipped for WebGL
```

### Shader (in InstancedAtlasBlockGroup.tsx: createAtlasMaterial)
```glsl
// Vertex: pass per-instance UV offset to fragment
attribute vec2 instanceUvOffset;
varying vec2 vInstanceUvOffset;

// Fragment: sample atlas at offset + local UV * slot_size
vec2 slotUv = clamp(fract(vMapUv), vec2(0.5/256.0), vec2(1.0 - 0.5/256.0));
vec2 atlasUv = vInstanceUvOffset + slotUv * (1.0/32.0);
vec4 color = texture2D(map, atlasUv);
```

### Atlas Sync Pipeline
```
1. useAtlasSync.ts fetches all definitions from Supabase (seeds, enemies, blocks)
2. Builds spec array with textureId + sourceUrl + slotIndex
3. atlasManager.batchSetTextures(): loads images in parallel, draws to canvas
4. Saves canvas to IndexedDB
5. Updates THREE.CanvasTexture.needsUpdate = true
6. Increments global atlas version -> triggers UV cache clear in renderers
```

### Known Atlas Issues
- **8192x8192 = 256MB GPU VRAM** (too large for mobile)
- **No mipmaps** -> aliasing at distance
- **IndexedDB can serve stale canvas** with mismatched slot metadata
- **Race condition**: blocks render before sync completes, using fallback UVs
- **getSlotForTexture() is O(N) linear scan** of all slots (should be Map lookup)

## Block Type Encoding (blockTypeEncoder.ts)

Tree blocks encode type + depth + tier into `block_type` string:
```
Format: {shortCode}_{depth}_{tier}
Examples: t_0_5 (trunk, depth 0, tier 5)
          b_1_3 (branch, depth 1, tier 3)
          fs_0_7 (fungal_stem, depth 0, tier 7)
          fct_0_7 (fungal_cap_top, depth 0, tier 7)

Short codes: t=trunk, b=branch, l=leaf, f=fruit, s=spike, n=nob, x=cross,
             sm=shroom, ss=shroom_stem, sc=shroom_cap, fs=fungal_stem,
             fct=fungal_cap_top, fcu=fungal_cap_underside, ib=invisiblock
```

decodeBlockType() parses these back to { type, depth, tier }.
getInstanceUVsForTreeBlock() decodes block_type -> tier + type -> atlas UV offset.

## Instanced Rendering Details

### InstancedAtlasBlockGroup (tree blocks)
- **One InstancedMesh** for all tree blocks in visible world
- **Capacity**: grows with headroom (1.5x), never shrinks
- **Attributes**: instanceMatrix (position), instanceUvOffset (atlas UV), instanceColor (branch depth lightening)
- **Budgeted rebuild**: 5000 blocks per RAF tick, 8ms budget per tick
- **Signature gating**: `${blocks.length}:${positionHash}:v${atlasVersion}` skips redundant rebuilds
- **Queue system**: if new blocks arrive mid-rebuild, queues re-rebuild instead of canceling (prevents flicker)
- **Atomic finalization**: UV/color/matrix all uploaded to GPU at once after all batches complete, then mesh.count set last

### InstancedBlockGroup (non-tree blocks)
- **One InstancedMesh per block type** (or per texture variant)
- **Synchronous rebuild** (non-tree blocks are typically few per type)
- **Individual textures** loaded per group (not atlas)
- **prevCountRef**: zero-out-tail to hide stale instances from previous larger arrays

### PlacedBlocks Grouping Logic
```typescript
for each block:
  if isTreeBlockType(block_type) -> atlasTreeBlocks (InstancedAtlasBlockGroup)
  else if isInvisiblock(block_type) -> invisiblocks (skip rendering)
  else -> grouped by block_type + texture variant (InstancedBlockGroup per group)
```

Occlusion culling: `cullOccludedBlocks()` removes interior tree blocks (surrounded on all 6 faces). Cached by `cheapGroupKey` to avoid recomputation when blocks haven't changed.

## Planned Architecture: Per-Chunk Rendering

### Target Data Flow
```
useChunkLoader.ts
    |
    v (exposes loadedChunksRef directly)
CameraTrackedBlocks.tsx
    |
    v (iterates chunks, renders one ChunkRenderer per chunk)
ChunkRenderer (React.memo)
    |
    v (only re-renders when this chunk's blocks reference changes)
PlacedBlocks.tsx (per chunk, ~500-2000 blocks instead of 180K)
    |
    v
InstancedAtlasBlockGroup (per chunk, ~1K tree blocks instead of 63K)
InstancedBlockGroup (per chunk)
```

### What Changes
1. **Mutations create new array references** per chunk (currently mutate in place)
2. **CameraTrackedBlocks iterates chunks** instead of flattening
3. **React.memo on ChunkRenderer** compares blocks by reference -> only dirty chunks re-render
4. **PlacedBlocks runs per-chunk** -> grouping is O(chunk_size) not O(world_size)
5. **Each chunk has its own instanced meshes** -> rebuild is O(chunk_size) not O(world_size)

### Expected Impact
| Metric | Before | After |
|--------|--------|-------|
| Work per chunk change | O(180K blocks) | O(2K blocks) |
| Grouping time | ~130ms | ~1ms |
| Mesh rebuild time | ~230ms | ~2ms |
| Chunk boundary stall | 1170ms | <10ms |
| Draw calls | ~48 | ~60-90 (acceptable) |

### Files to Modify
- `src/hooks/useChunkLoader.ts` — array reference stability on mutations
- `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx` — per-chunk iteration
- `src/components/ChunkRenderer.tsx` — new file, React.memo wrapper

### Files NOT Modified (reused as-is)
- `src/components/PlacedBlocks.tsx` — works per-chunk, just receives smaller arrays
- `src/components/InstancedAtlasBlockGroup.tsx` — works per-chunk, just receives fewer blocks
- `src/components/InstancedBlockGroup.tsx` — works per-chunk
- `src/lib/atlasManager.ts` — shared atlas texture, unchanged
- `src/hooks/useTextureAtlas.ts` — UV lookups unchanged

## Future Phases (Not Yet Planned)

- **Phase 2**: Vertical chunk sectioning (16x16x16 sections instead of 16x16xH columns)
- **Phase 3**: Greedy face meshing per chunk (merge coplanar faces into fewer triangles)
- **Phase 4**: Web Worker mesh building (off-thread chunk meshing)
- **Phase 5**: Atlas downsizing (64px slots on 2048x2048 instead of 256px on 8192x8192)
