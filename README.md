# Fortress

A browser-based 3D voxel game built with Three.js and React.

## Game Vision

Fortress is designed to support:
- **20-200 concurrent multiplayer players**
- **300+ block tall trees** with navigable labyrinthine interiors
- **Dozens of enemy types** with 10+ tiers each (100+ variations)
- **Beautiful visual effects** (fire, lightning, glitter, magic particles)
- **Cross-platform play** - must run smoothly on phones, tablets, and desktops

This is NOT a simple Minecraft clone. The environment features massive, complex tree structures that players climb through and battle within.

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

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Documentation

Detailed documentation for understanding the codebase:

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level system architecture |
| [PERFORMANCE.md](docs/PERFORMANCE.md) | Performance constraints and optimizations |
| [DATA_FLOW.md](docs/DATA_FLOW.md) | Three-tier cache system (Memory → IndexedDB → Supabase) |
| [CHUNKS.md](docs/CHUNKS.md) | Chunk loading, rendering, and visibility |
| [TREES.md](docs/TREES.md) | Tree generation, blueprints, and growth |
| [ENEMIES.md](docs/ENEMIES.md) | Enemy AI system and behaviors |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI assistants |

## Project Structure

```
src/
├── components/           # React components
│   ├── fortress/        # Core game (scene, controls, HUD)
│   └── Admin*.tsx       # Admin configuration panels
├── contexts/            # React contexts (BlocksContext, AuthContext)
├── features/            # Feature modules
│   ├── enemies/         # Universal enemy AI system
│   ├── trees/           # Tree generation and management
│   ├── particles/       # Visual effects
│   ├── shombie/         # Shombie enemy type
│   ├── walapa/          # Walapa enemy type
│   ├── shwarm/          # Shwarm enemy type
│   └── ...              # Other enemy types
├── hooks/               # Custom React hooks
│   ├── useChunkLoader.ts      # Chunk loading engine
│   └── usePlacedBlocksWithCache.ts  # Block sync layer
├── lib/                 # Utilities and services
│   ├── pathfinding/     # Navigation for enemies
│   └── spatialHashGrid.ts  # Collision detection
├── integrations/        # External services (Supabase)
└── types/               # TypeScript definitions
```

## Key Architectural Concepts

### Three-Tier Cache
```
Memory (loadedChunksRef) → IndexedDB → Supabase
```
- Memory for real-time rendering
- IndexedDB for offline persistence
- Supabase as source of truth

### Chunk-Based World
- World divided into 16×16 block horizontal chunks
- Progressive loading based on player position
- Surface culling removes interior blocks for rendering

### Instanced Rendering
- 200,000+ blocks rendered efficiently
- Texture atlas packs all tree textures
- Single draw call per block type

### LOD-Based Enemy AI
- Enemies tick at different rates based on distance
- Utility-based behavior selection
- Adapter pattern for type-specific logic

## Performance Targets

- **60 FPS** on mid-range mobile devices
- **<100ms** chunk load time
- **<16ms** frame budget
- **<200MB** memory footprint

## Contributing

See [CLAUDE.md](CLAUDE.md) for coding guidelines and project context.

## License

Proprietary - All rights reserved
