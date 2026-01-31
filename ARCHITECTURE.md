# Fortress Architecture Overview

> **For LLM auditors**: Start here, then read `RENDERING_PIPELINE.md` for the block rendering system we are actively rebuilding. `CODEBASE_MAP.md` has the full file-by-file reference.

## What This Project Is

Browser-based multiplayer voxel game built with React Three Fiber (Three.js). Players explore a world with procedurally generated trees (300+ blocks tall), place blocks, fight enemies, and collect loot. Must run on phones/tablets, not just desktop.

**Scale targets**: 20-200 concurrent players, millions of tree blocks, dozens of enemy types with 10 tiers each.

## Tech Stack

- **Renderer**: Three.js via @react-three/fiber
- **UI**: React 18 + Shadcn/ui + Tailwind
- **Backend**: Supabase (Postgres, Auth, Realtime)
- **Build**: Vite
- **State**: React Context + useRef for hot paths, React Query for server data

## High-Level Data Flow

```
Supabase DB
    |
    v
useChunkLoader.ts          -- fetches blocks by chunk (16x16 columns)
    |
    v
onBlocksChanged(flat[])    -- PROBLEM: flattens all chunks into one array
    |
    v
BlocksContext              -- stores flat array in React state
    |
    v
CameraTrackedBlocks.tsx    -- PROBLEM: re-flattens from loadedChunksRef, sorts, dedupes
    |
    v
PlacedBlocks.tsx           -- PROBLEM: groups ALL blocks by type (tree vs non-tree)
    |                         O(world_size) per change
    v
InstancedAtlasBlockGroup   -- ONE mesh for ALL tree blocks in visible world
InstancedBlockGroup        -- ONE mesh per non-tree block type
```

**The core architectural problem**: Chunks exist for loading but are erased before rendering. Every block change triggers O(world_size) flatten + group + rebuild. Minecraft does O(chunk_size) work per change.

## Active Rebuild: Per-Chunk Rendering

We are converting the rendering pipeline to Minecraft-style per-chunk rendering:
- Each chunk renders independently via its own component
- Block mutations only rebuild the affected chunk
- No global flattening, no global grouping

See `RENDERING_PIPELINE.md` for full details on current state and planned changes.

## System Map

### Block Rendering (the focus area)
| File | Role | Status |
|------|------|--------|
| `src/hooks/useChunkLoader.ts` | Chunk load/unload/mutate, collision | Has chunks, flattens for output |
| `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx` | Camera tracking, block visibility | Flattens all chunks into one array |
| `src/components/PlacedBlocks.tsx` | Groups blocks by type, routes to renderers | O(world) grouping per change |
| `src/components/InstancedAtlasBlockGroup.tsx` | Tree blocks via texture atlas + instancing | Single mesh for all trees |
| `src/components/InstancedBlockGroup.tsx` | Non-tree blocks via per-type instancing | One mesh per block type |

### Texture Atlas
| File | Role |
|------|------|
| `src/lib/atlasManager.ts` | Singleton atlas: 8192x8192 canvas, 32x32 grid of 256px slots |
| `src/lib/atlasLookup.ts` | UV coordinate lookups by texture ID |
| `src/lib/atlasMaterial.ts` | Three.js materials with atlas UV shader |
| `src/lib/atlasStorage.ts` | IndexedDB persistence for atlas |
| `src/hooks/useTextureAtlas.ts` | React hook + context-free UV functions for render loops |
| `src/hooks/useAtlasSync.ts` | Syncs Supabase texture definitions to atlas canvas |

### Chunk System
| File | Role |
|------|------|
| `src/lib/chunkManager.ts` | Chunk coordinate math, visibility calculations |
| `src/hooks/useChunkLoader.ts` | Loading, caching, mutations, collision grid |
| `src/contexts/BlocksContext.tsx` | Exposes chunks + flat blocks to React tree |

### Enemy AI
| File | Role |
|------|------|
| `src/features/enemies/ai/EnemyManager.ts` | Singleton, LOD-based tick distribution |
| `src/features/enemies/ai/BehaviorBrain.ts` | Decision tree for behavior selection |
| `src/features/enemies/ai/EnemySpatialIndex.ts` | Spatial queries for sensing |
| `src/features/enemies/adapters/*.ts` | Per-enemy-type integration |
| `src/features/enemies/behaviors/*.ts` | 10 behavior implementations |

### Tree Generation
| File | Role |
|------|------|
| `src/features/trees/lib/fungalTreeGenerator.ts` | Hollow mushroom trees (stem + cap + stairs) |
| `src/features/trees/lib/treeGrowth.ts` | Regular tree growth algorithms |
| `src/features/trees/lib/blockTypeEncoder.ts` | Encodes type/depth/tier into block_type string |

### Game Loop & Controls
| File | Role |
|------|------|
| `src/components/fortress/FortressScene.tsx` | Core 3D scene, lighting, camera, collision |
| `src/components/fortress/FortressControls.tsx` | First-person controls, raycasting, block placement |
| `src/components/fortress/useFortressFrameLoop.ts` | Main frame loop, entity updates |
| `src/lib/frameLoop.ts` | Global RAF-based frame loop with callback registry |

### Combat
| File | Role |
|------|------|
| `src/lib/damage/pipeline.ts` | Damage calculation (base -> armor -> status -> output) |
| `src/components/fortress/useFlamethrower.ts` | Flamethrower weapon with particle effects |
| `src/components/fortress/useBurnSystem.ts` | Burn damage over time |

## Key Constants

- **Chunk size**: 16x16 blocks (column, no vertical sectioning)
- **Atlas**: 8192x8192px, 32x32 grid, 256px per slot, 1024 total slots
- **Load radius**: ~4 chunks (configurable via visual distance)
- **Unload radius**: load radius + 2 chunks (hysteresis)
- **Block encoding**: `{shortCode}_{depth}_{tier}` e.g. `t_0_5` = trunk, depth 0, tier 5

## Performance Profile (Current - Needs Improvement)

From D-Flow diagnostics with ~180K visible blocks:
- **33-37 FPS average** (target: 60)
- **1170ms max frame** at chunk boundaries
- **14 grouping misses** costing 1785ms (regrouping ~2M block iterations)
- **14 mesh rebuilds** costing 3210ms (rebuilding 889K block instances)
- **126 long tasks** totaling 27.4 seconds in a 53-second session
- **JS Heap**: 660-778MB

Root cause: every chunk change triggers global flatten + group + rebuild = O(world_size).
Target: per-chunk rendering = O(chunk_size) per change.
