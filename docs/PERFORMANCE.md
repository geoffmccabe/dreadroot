# Fortress Performance Architecture

## Critical Constraint

**Target: 60 FPS on mid-range mobile devices** (phones, tablets, iPads)

This is a browser-based 3D voxel game built with Three.js that must support:
- 200,000+ blocks loaded simultaneously
- 20-200 concurrent multiplayer players
- 300+ block tall trees with complex branch structures
- Dozens of enemy types with AI pathfinding
- Beautiful particle effects (fire, lightning, glitter)

---

## Performance Bottlenecks (Ordered by Impact)

### 1. Draw Calls (GPU)
**Problem**: Each unique material/mesh combination requires a GPU draw call. Naive rendering of 200K blocks = 200K draw calls = 2 FPS.

**Solution: Instanced Rendering**
```
InstancedAtlasBlockGroup.tsx  → Tree blocks (90%+ of world)
InstancedBlockGroup.tsx       → User-placed blocks
```

Key techniques:
- **Texture Atlas**: All tree textures packed into single 4096×4096 atlas
- **InstancedMesh**: One draw call renders all instances of same block type
- **UV coordinates**: Per-instance UV offsets select texture from atlas
- **Result**: 200K blocks in ~50-100 draw calls

### 2. Memory Allocation (CPU/GC)
**Problem**: Creating new arrays/objects during render loop triggers garbage collection pauses (stutters).

**Solutions**:
- **Pre-allocated buffers**: `computeSurfaceVisibleBlocks()` reuses Uint8Array
- **Refs over state**: Use `useRef` for data that changes frequently
- **Object pooling**: Colliders cached in `colliderByBlockId` Map
- **Chunked loading/unloading**: Budgeted eviction prevents GC storms

### 3. React Re-renders (CPU)
**Problem**: Changing React state triggers component re-renders cascading through tree.

**Solutions**:
- **Hoisted hooks**: Expensive hooks called ONCE in `CameraTrackedBlocks`, passed down as props
- **Stable references**: `entryCacheRef` caches chunk entries to avoid memo busting
- **worldRevision counter**: Single number dependency instead of array comparison
- **visibleChunksRef**: Imperative updates bypass React entirely

### 4. Network Latency (Multiplayer)
**Problem**: Waiting for server confirmation blocks gameplay.

**Solutions**:
- **Optimistic updates**: Block placed immediately, synced later
- **Three-tier cache**: Memory → IndexedDB → Supabase (see DATA_FLOW.md)
- **Targeted refetch**: Only invalidated chunks refetched, not entire world
- **Realtime subscriptions**: `chunk_versions` changes trigger minimal updates

---

## Rendering Pipeline Optimizations

### Surface Culling
```
computeSurfaceVisibleBlocks()  in useChunkLoader.ts
```

Interior tree blocks (fully surrounded by other blocks) are removed from render list:
- Uses compact Uint8Array occupancy grid (16×16×H per chunk)
- O(1) neighbor lookup via array indexing
- Typically culls 60-80% of tree blocks
- Colliders still use full block list (collision needs interiors)

### Chunk-Based Visibility
```
CameraTrackedBlocks.tsx → classifies chunks by distance
```

- **Normal chunks** (within visualDistance): Full atlas rendering
- **Fade chunks** (visualDistance+1 to +3): Grey silhouette (reduced detail)
- **Unloaded** (beyond UNLOAD_RADIUS): Memory freed entirely

### LOD for Enemies
```
src/features/enemies/ai/types.ts → AILodLevel
```

- **ACTIVE**: Full AI tick rate (nearby enemies)
- **NEARBY**: Reduced tick rate
- **DISTANT**: Minimal updates
- **DORMANT**: Suspended until player approaches

---

## Key Performance Constants

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `CHUNK_SIZE` | 16 | chunkManager.ts | World divided into 16×16 horizontal tiles |
| `DEFAULT_LOAD_RADIUS` | 4 | useChunkLoader.ts | Chunks to load around player |
| `UNLOAD_HYSTERESIS` | 4 | useChunkLoader.ts | Extra buffer before unload |
| `MIN_RESIDENCY_MS` | 8000 | useChunkLoader.ts | Prevent unload thrashing |
| `COLLIDER_CREATION_BATCH` | 200 | useChunkLoader.ts | Colliders per frame |
| `CHUNK_UPDATE_THROTTLE` | 100ms | CameraTrackedBlocks | Visibility update rate |
| `POSITION_UPDATE_THROTTLE` | 200ms | useChunkLoader.ts | Load trigger rate |

---

## Measuring Performance

### Built-in Diagnostics
```typescript
import { diagnostics } from '@/lib/diagnosticsLogger';

diagnostics.e1  // Chunks loaded
diagnostics.e4  // Visibility updates
diagnostics.e5  // Collider count
```

### Console Logging
On first render, `CameraTrackedBlocks` logs:
```
[CameraTrackedBlocks] Pipeline: X chunks, Y blocks, atlasReady=true, blocksMapSize=Z
```

### Browser DevTools
- **Performance tab**: Look for long tasks during movement
- **Memory tab**: Watch for steadily increasing heap (leak)
- **Rendering tab**: Enable "FPS meter" overlay

---

## Common Performance Issues

### Symptom: Stutters when crossing chunk boundaries
**Cause**: Too many colliders created/removed in single frame
**Fix**: Adjust `COLLIDER_CREATION_BATCH` and `COLLIDER_REMOVAL_BATCH`

### Symptom: Low FPS despite few visible blocks
**Cause**: React re-renders from state changes
**Fix**: Check if expensive hooks called multiple times per frame

### Symptom: Memory grows unbounded
**Cause**: Chunk unloading not triggering, or collider leak
**Fix**: Verify `UNLOAD_RADIUS` logic, check `colliderByBlockId` size

### Symptom: Blocks disappear but colliders remain
**Cause**: `visibleBlocks` array empty but not null (see `??` vs length check)
**Fix**: Always check `visibleBlocks?.length` not just `visibleBlocks ??`

---

## Mobile-Specific Considerations

1. **Texture size**: Atlas capped at 4096×4096 for mobile GPU limits
2. **Memory budget**: Fewer simultaneous chunks on mobile
3. **Touch input**: Lower precision means larger interaction targets
4. **Thermal throttling**: Sustained load causes GPU clock reduction
5. **Battery**: Reduce particle effects when on battery power

---

## Future Optimization Opportunities

1. **Web Workers**: Offload pathfinding, surface culling to workers
2. **Frustum culling**: Skip chunks behind camera
3. **Occlusion culling**: Skip chunks blocked by solid geometry
4. **Mesh merging**: Combine static geometry into single mesh
5. **Progressive LOD**: Lower detail meshes for distant chunks
