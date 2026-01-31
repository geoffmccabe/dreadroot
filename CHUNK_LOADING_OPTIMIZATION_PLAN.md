# Chunk Loading Optimization Plan

## Problem
When crossing chunk boundaries, all tree blocks disappear and reappear one-by-one due to unnecessary React re-renders and mesh rebuilds.

---

## Phase 1: Decouple Mesh Rendering from React State

**Goal:** Stop pushing block data through React state on every chunk change.

**Current flow:**
```
scheduleEmit() → onBlocksChanged() → setBlocks() → React re-render → PlacedBlocks → InstancedAtlasBlockGroup
```

**New flow:**
```
scheduleEmit() → update blocksRef + increment revision → mesh reads from ref directly
```

**Changes:**

1. **usePlacedBlocksWithCache.ts**
   - Replace `useState<PlacedBlock[]>` with `useRef<PlacedBlock[]>`
   - Keep `worldRevision` counter for dependency tracking
   - `onBlocksChanged` updates ref and increments revision (no `setBlocks`)

2. **PlacedBlocks.tsx**
   - Accept `blocksRef` and `worldRevision` instead of `blocks` array
   - Use `worldRevision` in useMemo dependencies
   - Read from ref when revision changes

3. **InstancedAtlasBlockGroup.tsx**
   - No changes needed (already has signature-based rebuild gating)

**Risk:** Low - internal refactor, no API changes

---

## Phase 2: Re-enable Velocity-Based Prefetch

**Goal:** Pre-load chunks before player reaches them.

**Current state:** Prefetch system exists but is disabled (`PREFETCH_ENABLED = false`).

**Changes:**

1. **useChunkLoader.ts**
   - Set `PREFETCH_ENABLED = true`
   - Add "warm cache" concept: prefetched chunks stored but not emitted
   - Only promote warm→hot when player actually enters adjacent chunk
   - Add speed-based `PREFETCH_DISTANCE`: faster movement = look further ahead

2. **Warm cache behavior:**
   - Prefetched chunks go to `warmChunksRef` (not `loadedChunksRef`)
   - No emit triggered for warm chunks
   - On boundary cross: move warm→loaded, then emit once

**Risk:** Medium - prefetch was disabled due to stuttering; needs frame budget testing

---

## Phase 3: Atomic Chunk Transitions

**Goal:** Eliminate the window where chunks are missing during boundary crossing.

**Current behavior:**
```
1. loadSpecificChunks(stripeChunks) // async, doesn't block
2. unloadDistantChunks()            // sync, runs immediately
3. emit with missing chunks
4. stripe chunks finish loading
5. emit again with full chunks
```

**New behavior:**
```
1. loadSpecificChunks(stripeChunks) // async
2. await stripe chunks loaded
3. unloadDistantChunks()
4. emit once with complete data
```

**Changes:**

1. **useChunkLoader.ts - updatePlayerPosition()**
   - Make stripe chunk loading blocking (await before unload)
   - Or: batch both operations and emit only after both complete
   - Add flag to suppress intermediate emits during transition

**Risk:** Low-Medium - may add slight latency on boundary cross, but eliminates flicker

---

## Implementation Order

1. **Phase 1 first** - biggest impact, lowest risk
2. **Phase 3 second** - fixes flicker independent of prefetch
3. **Phase 2 last** - builds on Phase 1+3, requires tuning

## Success Metrics

- No visible flicker when crossing chunk boundaries
- No "one-by-one" block appearance
- FPS remains stable during chunk transitions
- Memory usage doesn't increase significantly
