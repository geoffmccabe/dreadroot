# Codebase File Map

> Complete file reference for the Fortress project. Files marked with **[HOT]** are on the critical rendering path being actively rebuilt.

## src/components/fortress/ (Core Game)

| File | Lines | Role |
|------|-------|------|
| `Fortress.tsx` | ~1400 | Main game container. Canvas setup, UI panels, tree/block placement modes, cycle system |
| `FortressScene.tsx` | ~1300 | **[HOT]** Core 3D scene. Camera, lighting, collision, enemy spawning, flamethrower damage loop |
| `FortressScene.CameraTrackedBlocks.tsx` | ~187 | **[HOT]** Camera-tracked chunk visibility. Currently flattens all chunks into one array for PlacedBlocks |
| `FortressControls.tsx` | ~1800 | First-person controls. WASD, mouse look, raycasting, block/seed placement, block removal |
| `useFortressFrameLoop.ts` | ~1200 | Main frame loop hook. Player position updates, entity awareness |
| `useFlamethrower.ts` | ~500 | Flamethrower weapon. Particle effects, tier progression, color tinting |
| `useBurnSystem.ts` | ~400 | Burn status effect. DOT tracking, visual flame attachment |
| `FortressHUD.tsx` | ~700 | HUD overlay. Health bars, crosshair, jetpack display, kill notifications |
| `ProceduralGround.tsx` | ~170 | Per-chunk ground plane with tiling texture |
| `FortressSky.tsx` | ~180 | Dynamic sky with time-of-day color cycling |
| `FortressLighting.tsx` | ~60 | Ambient + directional lights keyed to sky state |
| `FortressCoins.tsx` | ~250 | Collectible coin particles with hover animation |
| `FortressWaterfall.tsx` | ~200 | Waterfall with falling drop particles |
| `FortressBullets.tsx` | ~70 | Bullet particle pool |
| `FortressTracers.tsx` | ~160 | Bullet tracer line rendering |
| `FortressImpacts.tsx` | ~220 | Impact particle bursts |
| `UniversalFlameRenderer.tsx` | ~430 | Flame/fire visual effects renderer |
| `FortressJetBoostFX.tsx` | ~200 | Jet boost particles |
| `FortressNebulaImpacts.tsx` | ~180 | Nebula projectile impact effects |
| `DroppedItemRenderer.tsx` | ~110 | Dropped loot items in world |
| `WispBlock.tsx` | ~75 | Wisp collectible blocks |
| `FortressStructure.tsx` | ~160 | Base fortress geometry |
| `FortressAudio.ts` | ~240 | Audio element management |
| `FortressTypes.ts` | ~280 | TypeScript interfaces for scene, controls, audio |
| `fortressScene.constants.ts` | ~30 | Spawn position, max bullets, etc. |
| `flameEffectPresets.ts` | ~50 | Flame effect configuration |

## src/components/ (Block Rendering)

| File | Lines | Role |
|------|-------|------|
| `PlacedBlocks.tsx` | ~450 | **[HOT]** Block orchestrator. Splits blocks into tree/non-tree/invisiblock groups. Runs occlusion culling on trees. Routes to atlas or per-type renderers |
| `InstancedAtlasBlockGroup.tsx` | ~1077 | **[HOT]** Atlas-based instanced renderer for tree blocks. Single draw call via shared texture atlas. Budgeted multi-frame rebuild (5000 blocks/tick). Per-instance UV offsets + branch depth coloring |
| `InstancedBlockGroup.tsx` | ~600 | Non-tree instanced renderer. One InstancedMesh per block type with individual textures. Supports transparent, emissive, physical materials |

## src/hooks/ (Data & State)

| File | Lines | Role |
|------|-------|------|
| `useChunkLoader.ts` | ~2200 | **[HOT]** Central chunk system. Loads/unloads 16x16 chunks from Supabase. Manages block mutations (add/remove/replace). Collision grid (ensureBlockCollider). scheduleEmit batches changes via RAF. Surface visibility culling per chunk |
| `useTextureAtlas.ts` | ~466 | **[HOT]** Atlas React hook + context-free functions. getInstanceUVsForTreeBlock() decodes block_type -> tier + type -> UV offset. getTreeBlockAnimationInfo() for animated textures. Global atlas texture singleton |
| `useAtlasSync.ts` | ~453 | Syncs all Supabase texture definitions to atlas canvas. Tree, fungal, enemy, block, global textures. Batch parallel image loading. Saves to IndexedDB |
| `useBlocksData.ts` | ~160 | Block database queries with React Query caching |
| `usePlacedBlocksWithCache.ts` | ~850 | Legacy block fetching with signature-based caching (largely superseded by useChunkLoader) |
| `useIndexedDB.ts` | ~680 | IndexedDB persistence for chunk data. 7-day TTL |
| `useUserData.ts` | ~850 | User profile, inventory, health, stats, kills |
| `useMultiplayer.ts` | ~300 | Multiplayer player tracking via Supabase Realtime |
| `useEntityAwareness.ts` | ~190 | Entity presence detection for multiplayer |
| `useAnimatedTexture.ts` | ~300 | Animated texture frame cycling |
| `useRaycaster.ts` | ~100 | Three.js raycasting wrapper |
| `useWispBlock.ts` | ~200 | Wisp block collection mechanics |
| `useWorlds.ts` | ~190 | World list and switching |
| `useCurrentWorldId.ts` | ~100 | Current world ID from URL/context |
| `useUserCombatStats.ts` | ~200 | Combat statistics tracking |
| `usePathfindingConfigs.ts` | ~100 | Pathfinding algorithm selection |
| `useBillboardData.ts` | ~140 | Billboard sprite data fetching |
| `useModelsData.ts` | ~70 | 3D model data |
| `useStoredTextureAtlas.ts` | ~280 | Legacy atlas loading from storage |
| `useTreeAtlas.ts` | ~300 | Legacy tree-specific atlas (superseded by useTextureAtlas) |

## src/lib/ (Core Utilities)

| File | Lines | Role |
|------|-------|------|
| `atlasManager.ts` | ~860 | **[HOT]** Singleton atlas manager. 8192x8192 canvas, 32x32 grid of 256px slots. Slot allocation per category. Image loading (static + GIF + animation strips). Batch texture loading with parallel fetching. IndexedDB persistence |
| `atlasLookup.ts` | ~316 | **[HOT]** UV coordinate lookups. slotIndexToUVs(), getTreeUVs(), getFungalTreeUVs(), getShwarmUVs(), etc. Deterministic slot calculation as fallback. mapTreeBlockTypeToTextureType() |
| `atlasMaterial.ts` | ~250 | Three.js material factories. createAtlasLambertMaterial(), createAtlasStandardMaterial(), createAtlasHueShiftMaterial(). Custom shaders for per-instance UV offset + face shading |
| `atlasStorage.ts` | ~160 | Atlas IndexedDB persistence. Canvas to/from blob. Schema versioning |
| `textureAtlas.ts` | ~295 | Atlas constants (ATLAS_SLOT_SIZE=256, ATLAS_GRID_SIZE=32). Legacy AtlasRegistry class (being phased out) |
| `textureAtlasGenerator.ts` | ~280 | Legacy atlas generation from individual textures |
| `chunkManager.ts` | ~80 | Chunk coordinate math. CHUNK_SIZE=16, getChunkKey(), getVisibleChunkKeys() |
| `occlusionCulling.ts` | ~60 | cullOccludedBlocks(): removes interior blocks surrounded on all 6 faces. Uses Set-based neighbor lookup |
| `renderKeys.ts` | ~30 | canonicalizeTextureUrl(), getMaterialVariantId(), fnv1a32 hash |
| `frameLoop.ts` | ~80 | Global RAF frame loop. register(id, callback, priority). Used by AI, controls, coins, atlas blocks |
| `diagnosticsLogger.ts` | ~680 | D-Flow performance diagnostics. FPS, frame times, mesh rebuilds, grouping, flatten times, long tasks, event loop lag |
| `spatialHashGrid.ts` | ~300 | Spatial hash grid for collision. Cell-based block lookup. Used by useChunkLoader for colliders |
| `lineOfSight.ts` | ~200 | Ray-based line-of-sight between positions. Used by enemy sensing |
| `voxelRaycast.ts` | ~465 | DDA voxel raycasting for block selection/targeting |
| `budgetedWork.ts` | ~40 | Work queue with per-frame time budget |
| `spatialAudio.ts` | ~35 | 3D spatial audio positioning |
| `animationToStrip.ts` | ~400 | Convert GIF/animation to horizontal strip for atlas |
| `bulletScaling.ts` | ~50 | Bullet size/speed scaling per tier |
| `levelSystem.ts` | ~40 | XP thresholds and level calculation |
| `playerTracker.ts` | ~220 | Track player position history and movement vectors |

### src/lib/damage/ (Combat)
| File | Lines | Role |
|------|-------|------|
| `pipeline.ts` | ~200 | Damage calculation: base -> armor -> status -> output |
| `modifiers.ts` | ~100 | Armor, resistance, vulnerability multipliers |
| `statusEffects.ts` | ~80 | Burn, poison, slow effect application |
| `types.ts` | ~50 | DamageType enum, DamageResult interface |

### src/lib/pathfinding/ (AI Navigation)
| File | Lines | Role |
|------|-------|------|
| `pathfindingService.ts` | ~150 | Unified pathfinding API |
| `algorithmRegistry.ts` | ~80 | Algorithm registration |
| `astar.ts` | ~200 | A* algorithm |
| `astarWeighted.ts` | ~220 | Weighted A* |
| `dijkstra.ts` | ~180 | Dijkstra's algorithm |
| `bfs.ts` | ~150 | Breadth-first search |
| `greedyBest.ts` | ~170 | Greedy best-first |
| `jps.ts` | ~250 | Jump Point Search |
| `steering.ts` | ~130 | Steering behaviors |
| `randomization.ts` | ~80 | Random wander paths |

## src/contexts/ (Global State)

| File | Lines | Role |
|------|-------|------|
| `BlocksContext.tsx` | ~170 | **[HOT]** Exposes useChunkLoader data to React tree. blocksByChunk, loadedChunksRef, visibleChunksRef, worldRevision, updatePlayerPosition |
| `AuthContext.tsx` | ~120 | Supabase auth state |
| `InitializationContext.tsx` | ~220 | Startup progress tracking with step logging |
| `BulletDefinitionsContext.tsx` | ~190 | Bullet tier definitions from Supabase |
| `FlamethrowerTiersContext.tsx` | ~170 | Flamethrower tier definitions |
| `CoinThemeContext.tsx` | ~170 | Coin visual customization |
| `AvatarContext.tsx` | ~80 | Player avatar state |
| `AdminPanelContext.tsx` | ~50 | Admin panel visibility |
| `UserPanelContext.tsx` | ~30 | User panel state |

## src/types/ (Shared Types)

| File | Lines | Role |
|------|-------|------|
| `blocks.ts` | ~49 | PlacedBlock { id, world_id, block_type, position_x/y/z, texture_url, branch_depth, ... }. BlockType { id, key, name, properties: { color, emissive, transparent, ... } }. InventoryItem |
| `models.ts` | ~770 | 3D model definitions and rendering configs |

## src/features/ (Game Features)

### src/features/enemies/ (AI System)
| File | Lines | Role |
|------|-------|------|
| `ai/EnemyManager.ts` | ~400 | Singleton. LOD ticking (8Hz near, 2Hz far, 0Hz asleep). Registers with frameLoop |
| `ai/BehaviorBrain.ts` | ~300 | Decision tree: idle -> detect -> chase -> attack -> angry/revenge |
| `ai/EnemySpatialIndex.ts` | ~150 | Spatial grid for O(1) neighbor queries |
| `ai/types.ts` | ~100 | LOD levels, behavior enums, AI config |
| `behaviors/chase.ts` | ~120 | Chase behavior with pathfinding |
| `behaviors/attack.ts` | ~100 | Attack with cooldown and damage |
| `behaviors/patrol.ts` | ~80 | Patrol between waypoints |
| `behaviors/wander.ts` | ~70 | Random wandering |
| `behaviors/sleep.ts` | ~40 | Dormant until disturbed |
| `behaviors/angry.ts` | ~60 | Aggro state after taking damage |
| `behaviors/revenge.ts` | ~80 | Target last attacker |
| `behaviors/indignant.ts` | ~50 | Brief aggro response |
| `behaviors/returnHome.ts` | ~60 | Return to spawn |
| `adapters/ShwarmAdapter.ts` | ~200 | Shwarm AI integration |
| `adapters/ShombieAdapter.ts` | ~200 | Shombie AI integration |
| `adapters/ShnakeAdapter.ts` | ~200 | Shnake AI integration |
| `adapters/WalapaAdapter.ts` | ~200 | Walapa AI integration |
| `adapters/ShtickmanAdapter.ts` | ~200 | Shtickman AI integration |

### src/features/trees/ (Procedural Trees)
| File | Lines | Role |
|------|-------|------|
| `lib/blockTypeEncoder.ts` | ~275 | **[HOT]** Encode/decode block_type strings. isTreeBlockType(), decodeBlockType(), getBaseTreeBlockType(). Cached for performance (called 360K+/grouping) |
| `lib/fungalTreeGenerator.ts` | ~800 | Hollow mushroom tree generation. Stem (cylinder), cap (dome), spiral staircase, door |
| `lib/treeGrowth.ts` | ~600 | Regular tree growth: trunk, branches, leaves, fruit |
| `lib/fungalTreeConstants.ts` | ~100 | Per-tier configs: stem radius, cap radius, height |
| `lib/cylinderMath.ts` | ~150 | Circle/annulus geometry for tree cross-sections |
| `lib/seededRandom.ts` | ~40 | Deterministic PRNG for reproducible trees |
| `lib/fruitPhysics.ts` | ~80 | Fruit drop and pickup mechanics |
| `hooks/useTreeData.ts` | ~200 | Fetch planted trees from DB |
| `hooks/useLocalGrowth.ts` | ~300 | Client-side growth prediction |
| `hooks/useSeedPlanting.ts` | ~150 | Place new seeds |
| `hooks/useTreeChopping.ts` | ~200 | Remove trees with animation |
| `hooks/useFruitPickup.ts` | ~100 | Collect fruits |
| `types.ts` | ~80 | PlantedTree, SeedDefinition interfaces |

### src/features/shwarm/ (Swarm Enemies)
| File | Lines | Role |
|------|-------|------|
| `hooks/useShwarmSystem.ts` | ~400 | Main system: spawning, movement, damage, despawn |
| `hooks/useShwarmMovement.ts` | ~250 | Flocking behavior with separation/alignment/cohesion |
| `hooks/useShwarmDefinitions.ts` | ~100 | 10 tiers from Supabase |
| `components/ShwarmRenderer.tsx` | ~300 | Instanced particle rendering with atlas hue shift |

### src/features/shombie/ (Zombie Enemies)
| File | Lines | Role |
|------|-------|------|
| `hooks/useShombieSystem.ts` | ~350 | Main system with pathfinding and attack |
| `components/ShombieRenderer.tsx` | ~250 | Animated model rendering |

### src/features/shnake/ (Snake Enemies)
| File | Lines | Role |
|------|-------|------|
| `hooks/useShnakeSystem.ts` | ~400 | Multi-segment snake with slithering |
| `components/ShnakeRenderer.tsx` | ~300 | Per-segment instanced rendering |

### src/features/walapa/ (Creature Enemies)
| File | Lines | Role |
|------|-------|------|
| `hooks/useWalapaSystem.ts` | ~300 | Platform-riding creature AI |
| `components/WalapaRenderer.tsx` | ~250 | Multi-part creature rendering |

### src/features/shtickman/ (Humanoid Enemies)
| File | Lines | Role |
|------|-------|------|
| `hooks/useShtickmanSystem.ts` | ~350 | Melee humanoid with navmesh |
| `components/ShtickmanRenderer.tsx` | ~200 | Animated model rendering |
| `pathfinding.ts` | ~150 | Custom navmesh integration |
