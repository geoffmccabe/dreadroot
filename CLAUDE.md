# AI Assistant Instructions for Fortress

## Project Context

Fortress is a browser-based 3D voxel game with ambitious scale requirements:

- **20-200 concurrent multiplayer players** in same world
- **300+ block tall trees** with navigable labyrinthine interiors
- **100+ enemy variations** (dozens of types × 10+ tiers each)
- **Beautiful visual effects** (fire, lightning, glitter, magic particles)
- **Cross-platform** - must run on phones, tablets, AND desktops
- **Three.js based** - performance is absolutely critical

This is NOT a simple Minecraft clone. Trees are massive structures players climb through and battle within.

---

## Communication Rules

- NO code blocks or snippets in responses
- NO technical jargon or code explanations unless asked
- NO empathy, coddling, or excessive apologies
- Keep responses SHORT, professional, action-focused
- One-line explanations only when context needed
- Ask clarifying questions when requirements unclear

---

## Before Making Changes

1. **Read relevant files first** - understand existing code before modifying
2. **Check for broken functionality** - will this change break something else?
3. **Consider FPS/performance impact** - every change affects mobile users
4. **Avoid over-engineering** - minimal changes only, no gold-plating

---

## After Making Changes

Always audit for:
- Broken functionality elsewhere
- FPS/performance regressions
- Bugs and data flow errors
- Orphaned or duplicate code
- Technical debt introduced
- Hard-coded values that should be configurable

Conclude with list of all files added or changed.

---

## UI Rules

- NEVER add UI elements without explicit user request
- If new UI seems needed, ask first

---

## Critical Performance Patterns

### DO:
- Use `useRef` for frequently-changing data
- Use instanced rendering for blocks
- Use texture atlas for tree blocks
- Check `array?.length` not just `array ??` for fallbacks
- Budget expensive operations across frames
- Use LOD throttling for distant entities

### DON'T:
- Create objects in render loops (causes GC stutter)
- Use React state for real-time data
- Call expensive hooks multiple times per component
- Fetch entire world when only one chunk changed
- Block main thread with synchronous operations

---

## Key Architecture Concepts

### Three-Tier Cache
```
Memory (loadedChunksRef) → IndexedDB → Supabase
```
- Memory: Real-time rendering, collision
- IndexedDB: Offline persistence, fast reload
- Supabase: Source of truth, multiplayer sync

### Chunk System
- World divided into 16×16 block horizontal chunks
- Unlimited vertical extent (300+ block trees)
- Surface culling removes interior blocks for rendering
- Collision uses full block list, rendering uses culled list

### Rendering Split
- `blocks[]` - ALL blocks (collision detection)
- `visibleBlocks[]` - Surface-only (instanced rendering)

**CRITICAL BUG PATTERN**:
```typescript
// WRONG - ?? doesn't catch empty array []
const blocks = chunkData.visibleBlocks ?? chunkData.blocks;

// RIGHT - explicitly check length
const blocks = chunkData.visibleBlocks?.length ? chunkData.visibleBlocks : chunkData.blocks;
```

### Tree System
- Generated from seed definitions (deterministic)
- Stored as compressed blueprints
- Growth happens server-side
- Client refetches via chunk_versions subscription

### Enemy AI
- LOD-based tick throttling (distant enemies tick slower)
- Utility-based behavior selection
- Adapter pattern for type-specific logic
- Spatial indexing for O(1) proximity queries

---

## Documentation

Read these docs to understand the codebase:

| Document | What It Covers |
|----------|----------------|
| `docs/ARCHITECTURE.md` | High-level system overview |
| `docs/PERFORMANCE.md` | Performance constraints and patterns |
| `docs/DATA_FLOW.md` | Cache tiers and data synchronization |
| `docs/CHUNKS.md` | Chunk loading, visibility, lifecycle |
| `docs/TREES.md` | Tree generation, blueprints, growth |
| `docs/ENEMIES.md` | Enemy AI, behaviors, adapters |

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `src/hooks/useChunkLoader.ts` | Core chunk loading, caching, collision |
| `src/hooks/usePlacedBlocksWithCache.ts` | Block sync, realtime subscriptions |
| `src/contexts/BlocksContext.tsx` | Central block state provider |
| `src/components/fortress/FortressScene.tsx` | Main 3D scene setup |
| `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx` | Chunk visibility |
| `src/components/PlacedBlocks.tsx` | Block grouping and render dispatch |
| `src/components/InstancedAtlasBlockGroup.tsx` | Tree block instanced rendering |
| `src/features/trees/lib/treeGrowth.ts` | Tree generation algorithm |
| `src/features/enemies/ai/` | Universal enemy AI system |

---

## Common Tasks

### Adding a new enemy type
1. Create folder `src/features/{enemy-name}/`
2. Add types.ts, constants.ts, index.ts
3. Create components/{Enemy}Renderer.tsx
4. Create adapter in `src/features/enemies/ai/adapters/`
5. Register in EnemyManager

### Adding a tree decoration
1. Add block type to `TreeBlockType` union in types.ts
2. Add encoding in `blockTypeEncoder.ts`
3. Add generation function in `treeGrowth.ts`
4. Add texture to atlas

### Debugging chunk issues
1. Check console for `[CameraTrackedBlocks]` pipeline log
2. Verify `loadedChunksRef.size` vs expected
3. Check `visibleBlocks.length` vs `blocks.length`
4. Look for `??` vs `?.length` bugs

### Debugging performance
1. Open DevTools Performance tab
2. Look for long tasks (>50ms)
3. Check for repeated GC (object allocation in loops)
4. Verify instanced rendering (few draw calls for many blocks)
