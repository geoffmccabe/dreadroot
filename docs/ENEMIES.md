# Fortress Enemy System

## Overview

Fortress features **dozens of enemy types** with **10+ tiers each** (100+ variations). The AI system must:
- Handle hundreds of simultaneous enemies
- Navigate complex 3D tree environments
- Scale gracefully on mobile devices
- Support varied behavior patterns

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ENEMY SYSTEM ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   EnemyManager                                                   │
│   (Central coordinator)                                          │
│        │                                                         │
│        ├──► EnemySpatialIndex (O(1) proximity queries)           │
│        │                                                         │
│        └──► Per-Enemy State                                      │
│                  │                                               │
│                  ▼                                               │
│             EnemyAdapter ◄─── Type-specific logic                │
│             (Shombie, Walapa, Shwarm, etc.)                      │
│                  │                                               │
│                  ▼                                               │
│             BehaviorBrain                                        │
│             (Utility-based selection)                            │
│                  │                                               │
│                  ├──► SleepBehavior                              │
│                  ├──► WanderBehavior                             │
│                  ├──► ChaseBehavior                              │
│                  ├──► AttackBehavior                             │
│                  └──► AngryBehavior                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Enemy Types

### Current Implementations

| Type | File Location | Description |
|------|---------------|-------------|
| Shombie | `src/features/shombie/` | Zombie-like, slow but persistent |
| Walapa | `src/features/walapa/` | Agile climber |
| Shwarm | `src/features/shwarm/` | Swarm behavior, attacks in groups |
| Shnake | `src/features/shnake/` | Serpentine movement |
| Shtickman | `src/features/shtickman/` | Stick figure appearance |

### Tier System
Each enemy type has multiple tiers:
- **Tier 1-3**: Common, low HP/damage
- **Tier 4-6**: Uncommon, moderate stats
- **Tier 7-9**: Rare, high threat
- **Tier 10+**: Boss variants

Tiers affect:
- Health pool
- Damage output
- Movement speed
- Special abilities
- Visual appearance (size, color)

---

## AI System

**Location**: `src/features/enemies/ai/`

### LOD-Based Tick Throttling

Enemies tick at different rates based on distance from player:

```typescript
enum AILodLevel {
  ACTIVE,    // Full tick rate (nearby)
  NEARBY,    // Reduced rate
  DISTANT,   // Minimal updates
  DORMANT    // Suspended
}

const TICK_INTERVALS_MS = {
  [AILodLevel.ACTIVE]: 100,    // 10 Hz
  [AILodLevel.NEARBY]: 250,    // 4 Hz
  [AILodLevel.DISTANT]: 500,   // 2 Hz
  [AILodLevel.DORMANT]: Infinity
};
```

### Behavior Modules

Each behavior is a self-contained module:

```typescript
interface BehaviorModule {
  id: string;

  // 0-1 score indicating how much this behavior wants control
  calculateUtility(ctx: BehaviorContext): number;

  // Execute behavior, return next state
  execute(ctx: BehaviorContext): BehaviorResult;

  // Optional: setup/teardown
  enter?(ctx: BehaviorContext): void;
  exit?(ctx: BehaviorContext): void;
}
```

### Utility-Based Selection

BehaviorBrain picks active behavior via utility scoring:

```typescript
// BehaviorBrain.ts
selectBehavior(ctx: BehaviorContext): BehaviorModule {
  let best = null;
  let bestScore = -1;

  for (const behavior of this.behaviors) {
    const score = behavior.calculateUtility(ctx);
    if (score > bestScore) {
      bestScore = score;
      best = behavior;
    }
  }

  return best;
}
```

**Example Utilities**:
- `SleepBehavior`: High when player far, no recent damage
- `WanderBehavior`: Medium when idle, no threats
- `ChaseBehavior`: High when player in range, has LOS
- `AttackBehavior`: Very high when in melee range
- `AngryBehavior`: High when recently damaged

---

## Adapter Pattern

Type-specific logic is encapsulated in adapters:

```typescript
interface EnemyAdapter {
  type: string;

  // Convert raw DB data to runtime enemy
  create(def: EnemyDefinition): EnemyInstance;

  // Per-frame update (movement, animation)
  update(enemy: EnemyInstance, dt: number, ctx: SharedContext): void;

  // Handle taking damage
  onDamage(enemy: EnemyInstance, amount: number): void;

  // Handle death
  onDeath(enemy: EnemyInstance): void;

  // Get available behaviors for this type
  getBehaviors(): BehaviorModule[];
}
```

**Implementations**:
- `ShnakeAdapter` - Serpentine movement physics
- `ShwarmAdapter` - Flock coordination
- `ShombieAdapter` - Shambling movement
- (More per enemy type)

---

## Sensing System

**File**: `src/features/enemies/ai/sensing/lineOfSight.ts`

```typescript
hasLineOfSight(
  fromPos: Vector3,
  toPos: Vector3,
  collisionGrid: SpatialHashGrid
): boolean

canSeePoint(
  enemy: EnemyInstance,
  point: Vector3,
  maxDistance: number
): boolean
```

Uses raycasting against collision grid for efficient LOS checks.

---

## Spatial Indexing

**File**: `src/features/enemies/ai/EnemySpatialIndex.ts`

Efficient O(1) proximity queries for:
- Finding nearby enemies (flocking)
- Player detection radius
- Collision avoidance

```typescript
class EnemySpatialIndex {
  insert(enemy: EnemyInstance): void
  remove(enemy: EnemyInstance): void
  update(enemy: EnemyInstance): void

  getInRadius(pos: Vector3, radius: number): EnemyInstance[]
  getNearest(pos: Vector3, count: number): EnemyInstance[]
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/features/enemies/ai/index.ts` | Public API exports |
| `src/features/enemies/ai/types.ts` | TypeScript interfaces |
| `src/features/enemies/ai/EnemyManager.ts` | Central coordinator |
| `src/features/enemies/ai/BehaviorBrain.ts` | Behavior selection |
| `src/features/enemies/ai/EnemySpatialIndex.ts` | Spatial queries |
| `src/features/enemies/ai/behaviors/index.ts` | Behavior modules |
| `src/features/enemies/ai/adapters/index.ts` | Type adapters |
| `src/features/enemies/ai/sensing/lineOfSight.ts` | Vision system |
| `src/features/enemies/hooks/` | React integration |

---

## Per-Type Structure

Each enemy type follows this folder structure:

```
src/features/{enemy-type}/
├── types.ts              # Type definitions
├── constants.ts          # Configuration values
├── index.ts              # Public exports
├── components/
│   ├── {Type}Renderer.tsx    # 3D rendering
│   └── {Type}DesignPanel.tsx # Admin UI
└── hooks/
    ├── use{Type}Definitions.ts  # Fetch from DB
    └── use{Type}System.ts       # Runtime management
```

---

## Performance Considerations

1. **LOD throttling**: Distant enemies tick less frequently
2. **Spatial indexing**: O(1) proximity queries
3. **Zero-allocation design**: Reuse context objects
4. **Batched updates**: Process multiple enemies per frame
5. **Culled rendering**: Only render visible enemies

### Memory Budget

```typescript
// Rough per-enemy memory
struct EnemyInstance {
  position: 24 bytes    // Vector3
  velocity: 24 bytes    // Vector3
  state: 8 bytes        // Behavior state
  health: 4 bytes
  tier: 4 bytes
  // Total: ~100 bytes base
}

// 200 enemies = ~20KB
// 1000 enemies = ~100KB
```

---

## Pathfinding Integration

**Location**: `src/features/pathfinding/`

Enemies navigate the 3D tree environment via:
1. **Nav mesh** (TODO): Pre-computed walkable surfaces
2. **A* pathfinding**: Grid-based fallback
3. **Local avoidance**: Steering around obstacles

Complex tree interiors require careful pathfinding to avoid enemies getting stuck.

---

## Spawning System

Enemies spawn based on:
- Player location (not too close, not too far)
- Tree density (more enemies near trees)
- Time of day (some enemies nocturnal)
- Tier progression (higher tiers spawn further from spawn)

---

## Combat Integration

Enemies interact with combat system via:
- `onDamage()`: Receive damage, trigger AngryBehavior
- `onDeath()`: Drop loot, increment kill count
- `attackPlayer()`: Deal damage to player
- `attackBlock()`: Damage destructible blocks

Loot drops handled by `src/features/loot/`.
