# Fortress Architecture Overview

## Vision & Scale Requirements

Fortress is a browser-based 3D voxel game built with Three.js that must support:
- **20-200 concurrent multiplayer players**
- **300+ block tall trees** with labyrinthine interiors players navigate
- **Dozens of enemy types** with 10+ tiers each (100+ enemy variations)
- **Beautiful visual effects** (fire, lightning, glitter, magic)
- **Mobile/tablet support** - must run on phones and iPads, not just desktops

This is NOT a simple voxel game. The environment is extremely complex with convoluted tree structures that players climb through and battle within.

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Rendering | Three.js + @react-three/fiber | 3D graphics in browser |
| UI Framework | React 18 | Component-based UI |
| State Management | React Context + Refs | Minimize re-renders |
| Styling | Tailwind CSS + shadcn/ui | Consistent UI components |
| Database | Supabase (PostgreSQL) | Authoritative data store |
| Caching | IndexedDB | Client-side persistence |
| Realtime | Supabase Realtime | Multiplayer sync |
| Build | Vite | Fast dev/build |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER CLIENT                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   React UI  │  │  Three.js   │  │    Game Systems         │ │
│  │  (Panels,   │  │  (Renderer, │  │  (Enemies, Trees,       │ │
│  │   HUD)      │  │   Scene)    │  │   Physics, Combat)      │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         └────────────────┼──────────────────────┘               │
│                          │                                       │
│  ┌───────────────────────┴───────────────────────────────────┐  │
│  │                    BlocksContext                           │  │
│  │  (Central state for all block data, chunk management)      │  │
│  └───────────────────────┬───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┴───────────────────────────────────┐  │
│  │               Three-Tier Cache System                      │  │
│  │  Memory (loadedChunksRef) → IndexedDB → Supabase           │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      SUPABASE BACKEND                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ placed_     │  │ planted_    │  │ tree_blueprints         │ │
│  │ blocks      │  │ trees       │  │ (growth templates)      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ chunk_      │  │ seed_       │  │ user_profiles           │ │
│  │ versions    │  │ definitions │  │ (settings, inventory)   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Systems

### 1. Chunk System (`useChunkLoader.ts`)
The world is divided into 16×16 block horizontal chunks (unlimited vertical). Key concepts:
- **LOAD_RADIUS**: How many chunks around player to load (default: visual_distance + 3)
- **UNLOAD_RADIUS**: How far before chunks are unloaded (LOAD_RADIUS + 4)
- **Surface culling**: Interior tree blocks are culled to reduce render count
- **Signature-based change detection**: O(1) detection of chunk changes

### 2. Tree System (`src/features/trees/`)
Trees are the central gameplay element. Three tree types:
- **Original**: Classic branching trees with trunks, branches, leaves
- **Fungal**: Mushroom-like with stems and caps
- **Wide**: Massive trees with thick trunks and complex branch networks

Trees are generated from **blueprints** stored in `tree_blueprints` table. Growth is server-side.

### 3. Enemy System (`src/features/enemies/`)
Modular enemy system with AI adapters:
- Each enemy type (Shombie, Walapa, Shwarm, etc.) has its own feature folder
- AI behaviors defined in `src/features/enemies/ai/`
- Enemies navigate the complex tree environment via pathfinding

### 4. Rendering Pipeline
```
loadedChunksRef → CameraTrackedBlocks → ChunkRenderer → PlacedBlocks
                                                              ↓
                                              ┌───────────────┴───────────────┐
                                              ↓                               ↓
                                    InstancedAtlasBlockGroup      InstancedBlockGroup
                                    (tree blocks via atlas)       (user-placed blocks)
```

---

## Directory Structure

```
src/
├── components/           # React components
│   ├── fortress/        # Core game components (scene, controls, HUD)
│   ├── AdminPanel*.tsx  # Admin configuration panels
│   └── UserPanel.tsx    # Player inventory/stats
├── contexts/            # React contexts (BlocksContext, AuthContext)
├── features/            # Feature modules (enemies, trees, particles)
│   ├── enemies/         # Enemy system
│   ├── trees/           # Tree generation and management
│   ├── particles/       # Particle effects
│   └── [enemy-type]/    # Per-enemy-type folders
├── hooks/               # Custom React hooks
│   ├── useChunkLoader.ts      # Chunk loading engine
│   ├── usePlacedBlocksWithCache.ts  # Block sync layer
│   └── useIndexedDB.ts        # IndexedDB wrapper
├── lib/                 # Utilities and services
│   ├── atlasManager.ts  # Texture atlas management
│   ├── pathfinding/     # Navigation for enemies
│   └── spatialHashGrid.ts  # Collision detection
├── integrations/        # External service integrations
│   └── supabase/        # Supabase client and types
└── types/               # TypeScript type definitions
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/hooks/useChunkLoader.ts` | Core chunk loading, caching, collision |
| `src/hooks/usePlacedBlocksWithCache.ts` | Block sync, realtime subscriptions |
| `src/contexts/BlocksContext.tsx` | Central block state provider |
| `src/components/fortress/FortressScene.tsx` | Main 3D scene setup |
| `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx` | Chunk visibility |
| `src/components/PlacedBlocks.tsx` | Block grouping and rendering dispatch |
| `src/components/InstancedAtlasBlockGroup.tsx` | Tree block instanced rendering |
| `src/features/trees/lib/treeGrowth.ts` | Tree generation algorithm |
| `src/features/trees/hooks/useTreeData.ts` | Tree state management |

---

## Performance Constraints

The game MUST maintain 60 FPS on mid-range devices. Key constraints:

1. **Block count**: Worlds can have 200,000+ blocks loaded
2. **Draw calls**: Minimized via instanced rendering
3. **Memory**: Chunks unloaded when player moves away
4. **CPU**: Heavy work (pathfinding) offloaded to web workers
5. **Network**: Realtime sync must not block rendering

See `docs/PERFORMANCE.md` for detailed performance architecture.

---

## Data Flow Summary

1. **Initial Load**: IndexedDB cache → Supabase (if stale) → loadedChunksRef → render
2. **Block Placement**: Optimistic UI → Supabase sync → chunk_versions update
3. **Tree Growth**: Server-side → chunk_versions trigger → client refetch
4. **Multiplayer**: Supabase Realtime → chunk_versions subscription → targeted refetch

See `docs/DATA_FLOW.md` for detailed data flow documentation.
