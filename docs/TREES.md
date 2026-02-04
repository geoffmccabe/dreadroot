# Fortress Tree System

## Overview

Trees are the **central gameplay element** of Fortress. Unlike typical voxel games:
- Trees are 300+ blocks tall
- Interiors are navigable labyrinths
- Players climb through and battle within trees
- Trees grow over time (server-side simulation)

---

## Tree Types

### Original Trees
Classic branching structure:
- Central trunk rising from ground
- Horizontal branches at intervals
- Leaf canopy at branch ends
- Roots spreading at base

### Fungal Trees
Mushroom-like appearance:
- Thick stem (trunk equivalent)
- Large cap spreading at top
- Gill-like structures underneath
- Spore-producing features

### Wide Trees
Massive multi-trunk structures:
- Multiple trunk segments rising together
- Complex interconnected branch networks
- Enormous scale (widest tree type)
- Most labyrinthine interiors

---

## Generation Pipeline

```
Seed Definition (Supabase)
        │
        ▼
  useSeedPlanting.ts
        │
        ▼
  buildGrowthOptions()
        │
        ▼
┌───────┴───────────────────────────────┐
│                                       │
▼                                       ▼
treeGrowth.ts              wideTreeGenerator.ts
(original + fungal)        (wide trees)
        │                               │
        ▼                               ▼
   TreeBlueprint               TreeBlueprint
        │                               │
        └───────────┬───────────────────┘
                    │
                    ▼
           tree_blueprints table
           (compressed storage)
                    │
                    ▼
           planted_trees table
           (runtime state)
                    │
                    ▼
           placed_blocks table
           (world blocks)
```

---

## Seed Definitions

**Table**: `seed_definitions`

| Field | Type | Purpose |
|-------|------|---------|
| id | uuid | Primary key |
| seed_name | text | Display name |
| seed_value | integer | RNG seed for determinism |
| tree_type | text | 'original', 'fungal', 'wide' |
| trunk_height | integer | Base height |
| trunk_height_variability | float | Random height variation |
| branch_length | integer | Average branch extent |
| branch_chance | float | Probability of branch at node |
| leaf_density | float | Foliage coverage |
| symmetry_mode | text | 'none', '2xs', '4r', '4x2' |
| ... | ... | Many more parameters |

### Symmetry Modes

```
'none'  - Asymmetric, organic look
'2xs'   - 2 branches mirrored (4 total)
'4r'    - 4-way rotational (90° intervals)
'4x2'   - 4-way rotational + mirrored (8 blocks per placement)
```

---

## Blueprint System

Trees are generated as **blueprints** - compressed block arrays stored in `tree_blueprints`:

```typescript
interface TreeBlueprint {
  tree_id: string;
  blocks: BlueprintBlock[];
  metadata: {
    expectedBlockCount: number;
    boundingBox: { min: Point3D; max: Point3D };
    centerOfMass: Point3D;
  };
}

interface BlueprintBlock {
  x: number;      // Relative to tree origin
  y: number;
  z: number;
  type: string;   // Encoded block type
  depth?: number; // Branch depth for texturing
}
```

### Block Type Encoding

To save storage, block types use short codes:

```typescript
// blockTypeEncoder.ts
TREE_BLOCK_TYPE_MAP = {
  't': 'trunk',
  'b': 'branch',
  'l': 'leaf',
  'r': 'root',
  'f': 'fungal_stem',
  'c': 'cap',
  // ... more types
}
```

---

## Growth Algorithm

**File**: `src/features/trees/lib/treeGrowth.ts`

### Core Functions

```typescript
generateTreeBlueprint(options: TreeGrowthOptions): TreeBlueprint
// Main entry point - generates complete tree

growTrunk(blocks, occupied, x, z, height, options)
// Generates vertical trunk column

growBranch(blocks, occupied, startX, startY, startZ, dir, length, depth, options)
// Recursive branch generation with symmetry

addLeavesWithSymmetry(blocks, occupied, x, y, z, options)
// Foliage around branch ends
```

### Key Concepts

**Occupied Grid**: 3D boolean grid tracking placed blocks to prevent overlap
**Seeded Random**: All RNG uses seed value for deterministic generation
**Symmetry Transform**: Single placement becomes multiple via `applySymmetry()`
**Branch Depth**: Tracks how deep in branch hierarchy (affects texture)

---

## Tree Lifecycle

### 1. Planting
```typescript
// useSeedPlanting.ts
plantSeed(worldX, worldY, worldZ, seedDefId) {
  1. Fetch seed_definition
  2. Create planted_trees record (planted_at = now)
  3. Generate initial blueprint
  4. Store in tree_blueprints
  5. Create placed_blocks for current growth stage
}
```

### 2. Growth (Server-Side)
```typescript
// Server function (Edge Function or CRON)
growTrees() {
  1. Find trees where growth_stage < max_stage
  2. Calculate time since last growth
  3. If growth interval passed:
     - Generate next growth stage blueprint
     - Add new blocks to placed_blocks
     - Update planted_trees.growth_stage
     - Increment affected chunk_versions
}
```

### 3. Client Sync
```typescript
// Realtime subscription
onChunkVersionChange(chunkKey) {
  1. Refetch chunk from Supabase
  2. Merge new blocks into loadedChunksRef
  3. Recompute visibleBlocks (surface cull)
  4. Increment worldRevision
  // Tree "grows" visually as new blocks appear
}
```

### 4. Chopping
```typescript
// useTreeChopping.ts
chopTree(treeId) {
  1. Confirm with user (TreeChopConfirmModal)
  2. Mark planted_trees as chopped
  3. Delete all placed_blocks for tree
  4. Generate loot drops
  5. Update chunk_versions
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/features/trees/types.ts` | TypeScript interfaces |
| `src/features/trees/constants.ts` | Tree configuration constants |
| `src/features/trees/lib/treeGrowth.ts` | Original/fungal generation |
| `src/features/trees/lib/wideTreeGenerator.ts` | Wide tree entry point |
| `src/features/trees/lib/wideTreeTrunk.ts` | Wide tree trunk logic |
| `src/features/trees/lib/wideTreeBranches.ts` | Wide tree branch logic |
| `src/features/trees/lib/fungalTreeGenerator.ts` | Fungal-specific shapes |
| `src/features/trees/lib/blockTypeEncoder.ts` | Block type compression |
| `src/features/trees/lib/seededRandom.ts` | Deterministic RNG |
| `src/features/trees/hooks/useTreeData.ts` | React state management |
| `src/features/trees/hooks/useSeedPlanting.ts` | Planting operations |
| `src/features/trees/hooks/useTreeChopping.ts` | Chopping operations |
| `src/features/trees/components/SeedDesignPanel.tsx` | Admin UI for seeds |
| `src/features/trees/components/PlantedTreesPanel.tsx` | Tree management UI |

---

## Block Types

| Code | Full Name | Description |
|------|-----------|-------------|
| t_ | trunk | Main vertical structure |
| b_ | branch | Horizontal extensions |
| l_ | leaf | Foliage blocks |
| r_ | root | Underground spread |
| f_ | fungal_stem | Mushroom stalk |
| c_ | cap | Mushroom cap |
| s_ | spike | Decorative protrusions |
| n_ | nob | Knot-like features |
| sm_ | shroom | Small mushroom decorations |
| ib | invisiblock | Invisible collision block |

---

## Texture Atlas Integration

Tree blocks use a **texture atlas** for efficient rendering:

```typescript
// useTextureAtlas.ts
atlasCoords = {
  'trunk_1': { u: 0, v: 0, w: 64, h: 64 },
  'branch_1': { u: 64, v: 0, w: 64, h: 64 },
  // ...
}
```

Block's `branch_depth` determines which texture variant:
- Depth 0: Thickest trunk texture
- Depth 1-3: Progressively thinner branch textures
- Depth 4+: Twig/leaf textures

---

## Performance Considerations

1. **Blueprint caching**: Generated once, stored in DB
2. **Incremental growth**: Only new blocks added, not full regeneration
3. **Surface culling**: Interior blocks removed for rendering
4. **Chunk-based updates**: Only affected chunks refetched
5. **Signature comparison**: O(1) change detection prevents redundant work

---

## Verification (TODO)

Current gap: No checksum verification that all blueprint blocks exist in `placed_blocks`.

Planned solution:
1. Store `expected_count` in blueprint
2. On load, compare actual vs expected
3. If mismatch, refetch from blueprint
4. Add recovery queue for partial failures
