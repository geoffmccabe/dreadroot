# Universal Pathfinding System Plan

## Overview

Create a modular, reusable pathfinding API that any entity (enemies, NPCs, pets, vehicles) can use. The system will support multiple algorithms, configurable parameters, and an admin panel for management.

---

## Current State

- Pathfinding is hard-coded in `/src/features/shtickman/pathfinding.ts`
- Uses A* algorithm only
- No admin configuration
- No randomization support
- Tightly coupled to shtickman entity dimensions

---

## Phase 1: Core Pathfinding Service

### 1.1 Create Universal Pathfinding Library

**File:** `/src/lib/pathfinding/index.ts`

Export a singleton service with this API:

```typescript
interface PathfindingRequest {
  // Source position
  fromX: number;
  fromZ: number;

  // Target - one of these
  targetPosition?: { x: number; z: number };
  targetEntityId?: string;  // Player ID, enemy ID, etc.
  targetType?: 'player' | 'enemy' | 'npc' | 'location';

  // Entity dimensions for collision
  entityRadius: number;
  entityHeight: number;

  // Algorithm selection
  algorithmCode: string;  // e.g., 'astar', 'dijkstra', 'steering'

  // Randomization (0 = perfect, higher = more random)
  randomization?: number;  // Meters of variance

  // Optional overrides
  maxIterations?: number;
  gridSize?: number;
}

interface PathfindingResult {
  success: boolean;
  path: Vector3[] | null;
  algorithmUsed: string;
  computeTimeMs: number;
  nodesExplored?: number;
}

// Main API
pathfindingService.findPath(request: PathfindingRequest): PathfindingResult
pathfindingService.findPathAsync(request: PathfindingRequest): Promise<PathfindingResult>
```

### 1.2 Algorithm Registry

**File:** `/src/lib/pathfinding/algorithms/index.ts`

```typescript
interface PathfindingAlgorithm {
  code: string;           // Unique identifier
  name: string;           // Display name
  description: string;    // What it does
  category: 'grid' | 'steering' | 'hybrid';

  // The actual implementation
  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    entityRadius: number,
    entityHeight: number,
    options?: AlgorithmOptions
  ): Vector3[] | null;
}

// Registry
const algorithmRegistry = new Map<string, PathfindingAlgorithm>();
```

### 1.3 Implement Algorithm Files

| File | Code | Name | Description |
|------|------|------|-------------|
| `/src/lib/pathfinding/algorithms/astar.ts` | `astar` | A* Search | Optimal grid-based pathfinding using heuristic |
| `/src/lib/pathfinding/algorithms/astarWeighted.ts` | `astar_weighted` | Weighted A* | Faster but potentially suboptimal paths |
| `/src/lib/pathfinding/algorithms/dijkstra.ts` | `dijkstra` | Dijkstra's Algorithm | Guaranteed shortest path, slower |
| `/src/lib/pathfinding/algorithms/bfs.ts` | `bfs` | Breadth-First Search | Simple, good for uniform cost |
| `/src/lib/pathfinding/algorithms/greedyBest.ts` | `greedy` | Greedy Best-First | Fast but can get stuck |
| `/src/lib/pathfinding/algorithms/steering.ts` | `steering` | Steering Behavior | No grid, direct movement with obstacle avoidance |
| `/src/lib/pathfinding/algorithms/flowField.ts` | `flowfield` | Flow Field | Pre-computed for many entities to same target |
| `/src/lib/pathfinding/algorithms/jps.ts` | `jps` | Jump Point Search | Optimized A* for uniform grids |

### 1.4 Randomization Module

**File:** `/src/lib/pathfinding/randomization.ts`

```typescript
function applyRandomization(
  path: Vector3[],
  variance: number  // meters
): Vector3[] {
  // Add random offsets to waypoints
  // Ensure randomized path is still walkable
  // Smooth the result
}
```

---

## Phase 2: Database Schema

### 2.1 Pathfinding Configurations Table

```sql
CREATE TABLE pathfinding_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,        -- 'astar_default', 'steering_fast'
  name VARCHAR(100) NOT NULL,               -- Display name
  description TEXT,                         -- What this config is for
  algorithm_code VARCHAR(50) NOT NULL,      -- References algorithm

  -- Parameters
  grid_size DECIMAL DEFAULT 1.0,
  max_iterations INTEGER DEFAULT 1000,
  default_randomization DECIMAL DEFAULT 0,

  -- Algorithm-specific config (JSON)
  algorithm_params JSONB DEFAULT '{}',

  -- Metadata
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with defaults
INSERT INTO pathfinding_configs (code, name, description, algorithm_code, is_default)
VALUES
  ('astar_precise', 'A* Precise', 'Accurate pathfinding for important NPCs', 'astar', true),
  ('astar_fast', 'A* Fast', 'Faster pathfinding with larger grid', 'astar', false),
  ('steering_simple', 'Simple Steering', 'Direct movement for simple enemies', 'steering', false),
  ('swarm', 'Swarm Behavior', 'For large groups of enemies', 'flowfield', false);
```

### 2.2 Add to Enemy/NPC Definitions

```sql
ALTER TABLE enemy_definitions
ADD COLUMN pathfinding_config_code VARCHAR(50)
REFERENCES pathfinding_configs(code);

ALTER TABLE shtickman_definitions
ADD COLUMN pathfinding_config_code VARCHAR(50)
REFERENCES pathfinding_configs(code);
```

---

## Phase 3: Admin Panel Restructure

### 3.1 Rename and Reorganize Enemies Tab

**Current Structure:**
```
Admin Panel
├── Enemies (tab)
│   └── [enemy types, behaviors, etc.]
```

**New Structure:**
```
Admin Panel
├── NPCs (tab)
│   ├── Enemies (subtab)
│   │   ├── Shombies
│   │   ├── Shtickmen
│   │   └── [other enemy types]
│   ├── Friends (subtab)
│   │   ├── Allies
│   │   ├── Pets
│   │   └── Merchants
│   └── Pathfinding (subtab)
│       ├── Algorithm List
│       ├── Configuration Editor
│       └── Testing Tool
```

### 3.2 New Components

| Component | Purpose |
|-----------|---------|
| `/src/components/admin/NPCsPanel.tsx` | Main container with subtab navigation |
| `/src/components/admin/npcs/EnemiesSubtab.tsx` | Existing enemy management |
| `/src/components/admin/npcs/FriendsSubtab.tsx` | Future friendly NPC management |
| `/src/components/admin/npcs/PathfindingSubtab.tsx` | Pathfinding configuration |
| `/src/components/admin/npcs/pathfinding/AlgorithmList.tsx` | Display available algorithms |
| `/src/components/admin/npcs/pathfinding/ConfigEditor.tsx` | Edit pathfinding configs |
| `/src/components/admin/npcs/pathfinding/PathfindingTester.tsx` | Visual testing tool |

### 3.3 Pathfinding Admin UI

**Algorithm List View:**
- Table showing all registered algorithms
- Columns: Code, Name, Category, Description
- Read-only (algorithms are code-defined)

**Configuration Editor:**
- CRUD for pathfinding_configs table
- Form fields:
  - Code (unique identifier)
  - Name (display)
  - Description
  - Algorithm dropdown (from registry)
  - Grid Size slider (0.5 - 5.0)
  - Max Iterations slider (100 - 10000)
  - Default Randomization slider (0 - 5.0 meters)
  - Algorithm-specific params (dynamic based on selection)

**Testing Tool:**
- Mini 2D map view
- Click to set start point (green)
- Click to set end point (red)
- Dropdown to select pathfinding config
- "Find Path" button
- Shows resulting path on map
- Displays: compute time, nodes explored, path length

---

## Phase 4: Integration

### 4.1 Update Shtickman to Use Service

**File:** `/src/features/shtickman/hooks/useShtickmanSystem.ts`

```typescript
// Before
import { findPath } from '../pathfinding';

// After
import { pathfindingService } from '@/lib/pathfinding';

// In updateMovement:
const result = pathfindingService.findPath({
  fromX: shtickman.position.x,
  fromZ: shtickman.position.z,
  targetPosition: { x: shtickman.targetPos.x, z: shtickman.targetPos.z },
  entityRadius,
  entityHeight: bodyHeight,
  algorithmCode: shtickman.definition.pathfinding_config_code || 'astar_precise',
  randomization: 0.5,  // Could be from definition
});
```

### 4.2 Update Other Entities

Apply same pattern to:
- Shombies
- Future enemies
- Friendly NPCs
- Pets
- Any moving entity

---

## Phase 5: Performance Optimizations

### 5.1 Path Caching

```typescript
interface PathCache {
  key: string;  // Hash of start + end + config
  path: Vector3[];
  timestamp: number;
  ttlMs: number;
}
```

### 5.2 Web Worker for Heavy Computation

**File:** `/src/lib/pathfinding/pathfindingWorker.ts`

- Move expensive algorithms to web worker
- Main thread sends request, receives result
- Prevents frame drops during pathfinding

### 5.3 Batch Processing

```typescript
// For many entities going to same target
pathfindingService.findPathsToTarget(
  entities: { id: string; x: number; z: number }[],
  target: { x: number; z: number },
  algorithmCode: string
): Map<string, PathfindingResult>
```

---

## File Structure Summary

```
/src/lib/pathfinding/
├── index.ts                    # Main service export
├── types.ts                    # TypeScript interfaces
├── pathfindingService.ts       # Core service class
├── algorithmRegistry.ts        # Algorithm registration
├── randomization.ts            # Path randomization
├── pathCache.ts                # Caching layer
├── pathfindingWorker.ts        # Web worker (optional)
└── algorithms/
    ├── index.ts                # Export all algorithms
    ├── base.ts                 # Base algorithm interface
    ├── astar.ts                # A* implementation
    ├── astarWeighted.ts        # Weighted A*
    ├── dijkstra.ts             # Dijkstra's
    ├── bfs.ts                  # Breadth-first search
    ├── greedyBest.ts           # Greedy best-first
    ├── steering.ts             # Steering behaviors
    ├── flowField.ts            # Flow field (for swarms)
    └── jps.ts                  # Jump point search

/src/components/admin/
├── NPCsPanel.tsx               # Main NPCs tab container
└── npcs/
    ├── EnemiesSubtab.tsx       # Enemy management
    ├── FriendsSubtab.tsx       # Friend management
    └── PathfindingSubtab.tsx   # Pathfinding config
        └── pathfinding/
            ├── AlgorithmList.tsx
            ├── ConfigEditor.tsx
            └── PathfindingTester.tsx

/src/hooks/
└── usePathfindingConfigs.ts    # React Query hook for configs

/src/integrations/supabase/
└── types/                      # Add pathfinding_configs type
```

---

## Implementation Order

1. **Create core service structure** (types, registry, base service)
2. **Move existing A* to new location** as first algorithm
3. **Update shtickman to use new service** (verify still works)
4. **Add database table and migration**
5. **Create admin panel components**
6. **Implement additional algorithms** (one at a time)
7. **Add randomization support**
8. **Add caching layer**
9. **Optional: Web worker for performance**

---

## Estimated Scope

| Phase | Files | Complexity |
|-------|-------|------------|
| Phase 1: Core Service | 8-10 | Medium |
| Phase 2: Database | 2-3 | Low |
| Phase 3: Admin Panel | 6-8 | Medium |
| Phase 4: Integration | 2-3 | Low |
| Phase 5: Optimizations | 2-3 | Medium |

---

## Decisions Made

1. **Scope:** Global pathfinding configs (not per-world)
2. **Algorithms:** All algorithms implemented, admins can edit descriptions
3. **Testing Tool:** 2D overhead map view in admin panel - click to set start/end, see path drawn
4. **Randomization Modes:**
   - `straight` - No randomization, direct path
   - `curved` - Smooth curves with bezier interpolation
   - `jagged` - Random offsets at each waypoint
