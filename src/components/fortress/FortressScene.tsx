import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBulletDefinitions } from '@/contexts/BulletDefinitionsContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { FOG_DISTANCE_CHUNKS, FOG_DENSITY, fogState, updateFogForHeight } from '@/lib/fogConfig';
import { registerWarmupContext } from '@/lib/shaderWarmup';
// Side-effect import: patches THREE's fog falloff to linear-d exponential
// so per-chunk visibility decays geometrically (see fogShaderPatch.ts).
import '@/lib/fogShaderPatch';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useRaycaster } from '@/hooks/useRaycaster';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useWispBlock } from '@/hooks/useWispBlock';
import { useWorldPonds } from '@/hooks/useWorldPonds';

import { BillboardWalls } from '@/components/BillboardWalls';
import { PlacedBlocks } from '@/components/PlacedBlocks';
import { ProceduralGround } from './ProceduralGround';
import { MultiplayerPlayers } from '@/components/MultiplayerPlayers';
import { LocalPlayerAvatar } from '@/components/LocalPlayerAvatar';
import { FirstPersonArms } from '@/components/FirstPersonArms';
import { SceneReflections } from '@/components/SceneReflections';
import { FPSCounter, FPSCounterHandle } from '@/components/FPSCounter';
import { WispBlock } from '@/components/WispBlock';

import { FirstPersonControls } from './FortressControls';
import { DynamicSky, SkyHandle } from './FortressSky';
import { DynamicLighting, LightingHandle } from './FortressLighting';
import { FortressStructure } from './FortressStructure';
import { BlockInspectorHighlight } from './BlockInspectorHighlight';
// import { FortressParticles } from './FortressParticles'; // Disabled for performance
import { Waterfall } from './FortressWaterfall';
import { Coins } from './FortressCoins';
import { Bullets, BulletsHandle } from './FortressBullets';
import { BulletImpacts, BulletImpactsHandle } from './FortressImpacts';
import { UniversalFlameRenderer, UniversalFlameRendererHandle } from './UniversalFlameRenderer';
import { FlameDemoSpawner } from './FlameDemoSpawner';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { NebulaImpacts, NebulaImpactsHandle } from './FortressNebulaImpacts';
import { Tracers, TracersHandle } from './FortressTracers';
import { SceneProps, WispParticle, JetBoostState } from './FortressTypes';
import { FortressJetBoostFX, JetBoostFXHandle } from './FortressJetBoostFX';
import { WispParticlesMesh, type WispParticlesMeshHandle } from './FortressScene.WispParticlesMesh';
import { CameraTrackedBlocks } from './FortressScene.CameraTrackedBlocks';
import { useFortressShooting } from './useFortressShooting';
import { useFlamethrower } from './useFlamethrower';
import { useFlamethrowerTiers } from '@/contexts/FlamethrowerTiersContext';
import { useFortressFrameLoop } from './useFortressFrameLoop';
import { MAX_BULLETS, type BulletLocal } from './fortressScene.constants';
export type { WispParticlesMeshHandle } from './FortressScene.WispParticlesMesh';
import { createAudioRefs, initializeAudioElements, createThrottledAudioPlayer } from './FortressAudio';
import { getVisibleChunkKeys } from '@/lib/chunkManager';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { worldCollisionGrid, entityCollisionGrid } from '@/lib/spatialHashGrid';

// Shwarm system imports
import { useShwarmSystem, useShwarmMovement, ShwarmRenderer, ShwarmRendererHandle } from '@/features/shwarm';
import { useShnakeSystem, useShnakeMovement, ShnakeRenderer, ShnakeRendererHandle } from '@/features/shnake';
import { useShombieSystem, ShombieRenderer, ShombieRendererHandle, SHOMBIE_HITBOX_RADIUS, SHOMBIE_HITBOX_HEIGHT } from '@/features/shombie';
import { useWalapaSystem, WalapaRenderer, WalapaRendererHandle, WALAPA_HITBOX_RADIUS, WALAPA_HITBOX_HEIGHT } from '@/features/walapa';
import { useShtickmanSystem, ShtickmanRenderer, ShtickmanRendererHandle, SHTICKMAN_HITBOX_RADIUS } from '@/features/shtickman';
import { useShpiderSystem, ShpiderRenderer, useShpiderDefinitions } from '@/features/shpider';
import { useShpiderEggSystem, ShpiderEggRenderer } from '@/features/shpider-eggs';
import { useGrenadeSystem, GrenadeRenderer, ExplosionFX, type ExplosionFXHandle } from '@/features/grenades';
import { VaultProximityWatcher } from '@/features/vault';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getHeightBlocks } from '@/features/shtickman/types';

// Tree system imports
import { TreeInfoLabels } from '@/features/trees/components/TreeInfoLabels';
import { WideTreeLights } from '@/features/trees/components/WideTreeLights';
import { GlowLightPool } from '@/components/GlowLightPool';
import { FruitRenderer } from '@/components/FruitRenderer';
import { DiamondRenderer } from '@/components/DiamondRenderer';
import { renderedChunkKeys } from '@/lib/renderedChunks';
import { useTreePlanterNames } from '@/features/trees/hooks/useTreePlanterNames';
import { useFruitSpawning } from '@/features/trees/hooks/useFruitSpawning';
import { useFruitPickup } from '@/features/trees/hooks/useFruitPickup';
import { PulsingSeedBlocks } from '@/features/trees/components/PulsingSeedBlocks';
import { GrowthProximityWatcher } from '@/features/trees/components/GrowthProximityWatcher';

// Universal Enemy AI system (Phase 3)
import { useEnemyAI } from '@/features/enemies/ai';
import { initializeShnakeRevenge, markShnakeIndignant, recordShnakeRevengeDamage } from '@/features/enemies/ai/adapters/ShnakeAdapter';

// Universal spawn command system
import { useSpawnCommands } from '@/features/enemies/hooks/useSpawnCommands';

// Loot drop system
import { useDropTableCache } from '@/features/loot/useDropTableCache';
import { useLootPickup } from '@/features/loot/useLootPickup';
import { DroppedItemRenderer } from './DroppedItemRenderer';
import type { DroppedWorldItem, ShwarmDefinition } from '@/features/shwarm/types';

// Universal burn system (flamethrower DOT)
import { useBurnSystem } from './useBurnSystem';

// Universal Enemy Spawner (UES) - single system for all natural enemy spawning
import { useEnemySpawnerIntegration } from '@/features/enemies/hooks/useEnemySpawnerIntegration';

// Override Three.js fog to use radial distance instead of planar z-depth.
// Default THREE.Fog uses -mvPosition.z (z-depth from camera plane), which
// creates a flat "wall" of fog — objects at screen edges get less fog than
// objects at screen center at the same real distance. Using length(mvPosition.xyz)
// gives true spherical fog that fades uniformly in all directions.
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = length( mvPosition.xyz );
#endif
`;

// Camera-tracked block renderer with chunk culling
// Calculate which face of the block was hit based on hit position
export function FortressScene({
  settings,
  onCoinHit,
  wallPositions,
  blockPlacementMode,
  treePlacementMode,
  fungalPlacementMode,
  widePlacementMode,
  onBlockPlace,
  onTreePlace,
  onFungalTreePlace,
  onWideTreePlace,
  onModeChange,
  onOpenPanel,
  onOpenMarketplace,
  onToggleInventory,
  crosshairsEnabled,
  getBlockQuantity,
  selectedBlockType,
  selectedSeedTier,
  selectedFungalTier,
  selectedWideTier,
  panelOpen,
  onCycleBlock,
  onCycleSeed,
  onCycleFungalSeed,
  onCycleWideSeed,
  blocks,
  weatherSettings,
  onBlockRain,
  coinImageUrl,
  userRoles,
  isMoveMode,
  onBlockRemove,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  setHoveredBlockId,
  collectWispBlock,
  toast,
  waterfallEnabled = true,
  onGodModeChange,
  performanceMode = false,
  fortressTextureUrl,
  groundTextureUrl,
  skyTextureUrl,
  seedDefinitions = [],
  healthRef,
  applyDamageWithKnockback,
  takeDamage,
  shwarmDefinitions,
  onShwarmDamage,
  onPointsEarned,
  onShwarmGroupKilled,
  onShnakeKilled,
  onShombieKilled,
  respawnPosition,
  onRespawnComplete,
  isOwnedTreeAtPosition,
  onTreeChopComplete,
  onTreeChopProgress,
  onBlockMineComplete,
  selectedBulletTier = 1,
  onBulletTierChange,
  playerLevel = 1,
  onPentabulletChargeChange,
  onUseHotbarSlot,
  consumeGrenade,
  onGrenadeTogglePress,
  grenadeReady,
  consumeEgg,
  onEggTogglePress,
  eggReady,
  onHealthPotionUse,
  onGrowthProximityChange,
  onShpiderKilled,
  onAdminGrantGrenade,
  onAdminGrantHealthPotion,
  vaultInRange,
  onVaultProximityChange,
  onOpenVault,
  shnakeDefinitions,
  plantedTrees = [],
  treeFruits = [],
  onFruitRemoved,
  shombieDefinitions,
  walapaDefinitions,
  onWalapaKilled,
  shtickmanDefinitions,
  onShtickmanKilled,
  onJetBoostStateChange,
  selectedItemDef,
  addItem,
  lightningSettings,
  viewSettings,
}: SceneProps) {
  // Phase 2B: Get updatePlayerPosition from context for chunk loading
  const { updatePlayerPosition, blocks: allLoadedBlocks, isLoading: blocksLoading, worldRevision, loadedChunksRef: chunksRef, currentWorldId } = useBlocks();

  // Pond system for swimming
  const worldPonds = useWorldPonds(currentWorldId);

  // Delay enemy spawning until blocks are loaded (prevents enemies showing before trees)
  // Phase 2: Use worldRevision instead of flat blocks array length
  const enemiesEnabled = !blocksLoading && worldRevision > 0;
  const { camera } = useThree();
  
  // Fetch usernames for tree labels
  const { usernamesMap } = useTreePlanterNames(plantedTrees);

  // Camera ref — used by many subsystems below
  const cameraRef = useRef<THREE.Camera>(camera);
  cameraRef.current = camera;

  // Fruit spawning - runs on interval, inserts fruits into DB under branch blocks
  useFruitSpawning({
    plantedTrees,
    treeFruits,
    worldId: currentWorldId,
    userId: currentUserId ?? null,
    cameraRef,
  });

  // Fruit harvesting - F-key system with tier rolling
  const { findClosestFruit, harvestNearest } = useFruitPickup({
    treeFruits,
    plantedTrees,
    userId: currentUserId ?? null,
    cameraRef,
    toast,
    addItem,
    onFruitRemoved,
  });

  // Create seed textures map for pulsing seed blocks
  const seedTexturesByTier = useMemo(() => {
    const map = new Map<number, string>();
    for (const sd of seedDefinitions) {
      if (sd.fruit_texture_url) {
        map.set(sd.tier, sd.fruit_texture_url);
      }
    }
    return map;
  }, [seedDefinitions]);

  // Shwarm/Shnake system - needs ALL loaded blocks, not just visible ones
  const blocksRef = useRef(allLoadedBlocks);
  blocksRef.current = allLoadedBlocks;
  
  // Loot drop system
  const { rollDrop, isLoaded: dropTablesLoaded } = useDropTableCache();
  const [droppedItems, setDroppedItems] = useState<DroppedWorldItem[]>([]);
  const droppedItemsRef = useRef<DroppedWorldItem[]>([]);
  useEffect(() => { droppedItemsRef.current = droppedItems; }, [droppedItems]);

  const handleItemPickedUp = useCallback((dropId: string) => {
    setDroppedItems(prev => prev.filter(i => i.id !== dropId));
  }, []);



  const noopAddItem = useCallback(async (_id: string, _qty: number) => false, []);
  useLootPickup({
    droppedItemsRef,
    userId: currentUserId ?? null,
    cameraRef,
    addItem: addItem ?? noopAddItem,
    onItemPickedUp: handleItemPickedUp,
  });

  // Callback when entire shwarm group is killed - play yay sound, notify parent
  const handleShwarmGroupKilled = useCallback((tier: number, _definition: ShwarmDefinition, _centerPosition: THREE.Vector3) => {
    if (audioRefs.current.shwarmGroupKilled) {
      audioRefs.current.shwarmGroupKilled.currentTime = 0;
      audioRefs.current.shwarmGroupKilled.play().catch(() => {});
    }

    // Notify parent for kill tracking
    onShwarmGroupKilled?.(tier);
  }, [onShwarmGroupKilled]);

  // Callback when an individual shwarm block is killed - roll loot drop
  // Use current definition (not baked-in spawn-time snapshot) so admin panel changes take effect immediately
  const handleShwarmBlockKilled = useCallback((definition: ShwarmDefinition, blockPosition: THREE.Vector3) => {
    if (!dropTablesLoaded) {
      console.warn(`[Loot] Block killed but drop tables not loaded yet — skipping`);
      return;
    }
    // Look up current definition by tier so admin panel changes apply to existing shwarms
    const currentDef = shwarmDefinitions?.find(d => d.tier === definition.tier) ?? definition;
    console.log(`[Loot] Block killed T${currentDef.tier}, drop_rate=${currentDef.drop_rate}, table=${currentDef.drop_table_code}`);
    const drop = rollDrop(currentDef.drop_rate, currentDef.drop_table_code);
    if (drop) {
      if (!currentUserId) {
        console.warn(`[Loot] Drop rolled successfully but currentUserId is null — skipping`);
        return;
      }
      const worldItem: DroppedWorldItem = {
        id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemNumber: drop.itemNumber,
        itemName: drop.itemName,
        itemId: drop.itemId,
        position: blockPosition.clone(),
        droppedAt: Date.now(),
        killerUserId: currentUserId,
        pickedUp: false,
      };
      console.log(`[Loot] Spawning world item: ${drop.itemName} at (${blockPosition.x.toFixed(1)}, ${blockPosition.y.toFixed(1)}, ${blockPosition.z.toFixed(1)})`);
      setDroppedItems(prev => [...prev, worldItem]);
    }
  }, [rollDrop, currentUserId, dropTablesLoaded, shwarmDefinitions]);
  
  const { shwarms, shwarmsRef, damageBlock, spawnShwarmByTier, spawnShwarmAt } = useShwarmSystem({
    definitions: shwarmDefinitions,
    cameraRef,
    blocksRef,
    isEnabled: enemiesEnabled,
    onGroupKilled: handleShwarmGroupKilled,
    onBlockKilled: handleShwarmBlockKilled,
  });
  
  // Player hit callback for shwarm collisions - uses universal damage system
  const handleShwarmPlayerHit = useCallback((damage: number, knockbackForce: number, direction: THREE.Vector3) => {
    // Defer to avoid render loop issues
    setTimeout(() => {
      // Use universal damage system if available (includes STEADY, armor, i-frames)
      if (applyDamageWithKnockback) {
        applyDamageWithKnockback(
          damage,
          direction.clone(),
          knockbackForce,
          { type: 'enemy', entityName: 'Shwarm' }
        );
      } else if (takeDamage) {
        // Fallback to legacy function
        takeDamage(damage, direction.clone(), knockbackForce);
      }
      
      // Play player hit sound
      if (audioRefs.current.playerHit) {
        audioRefs.current.playerHit.currentTime = 0;
        audioRefs.current.playerHit.play().catch(() => {});
      }
    }, 0);
  }, [applyDamageWithKnockback, takeDamage]);
  
// Shpider touch-attack handler. Mirrors handleShwarmPlayerHit:
// universal damage system if available, else legacy takeDamage,
// always plays the player-hit sound.
const handleShpiderPlayerHit = useCallback((damage: number, knockback: number, direction: THREE.Vector3) => {
  setTimeout(() => {
    if (applyDamageWithKnockback) {
      applyDamageWithKnockback(damage, direction.clone(), knockback, { type: 'enemy', entityName: 'Shpider' });
    } else if (takeDamage) {
      takeDamage(damage, direction.clone(), knockback);
    }
    if (audioRefs.current.playerHit) {
      audioRefs.current.playerHit.currentTime = 0;
      audioRefs.current.playerHit.play().catch(() => {});
    }
  }, 0);
}, [applyDamageWithKnockback, takeDamage]);

// Universal Enemy AI system control flag
// Phase G: AI system enabled - controls all enemy behaviors via EnemyManager.
// Legacy movement hooks are disabled when this is true.
const ENABLE_ENEMY_AI = true; // Universal AI + Fortress Safe Zone active

// Legacy movement hooks use aiControlled to disable their internal loops.
const AI_CONTROLLED = ENABLE_ENEMY_AI;

// Debug flag for bullet tracking logs - disable in production for FPS
const DEBUG_BULLETS = false;

// Use Nebula particle system for bullet impacts (sky-friendly alpha transparency)
// Set to false to use three-particle-fire (has dark halo artifacts against sky)
const USE_NEBULA_FOR_BULLET_IMPACTS = false;
  
  useShwarmMovement({
    shwarmsRef,
    cameraRef,
    isEnabled: enemiesEnabled,
    aiControlled: AI_CONTROLLED,
    onPlayerHit: handleShwarmPlayerHit,
  });
  
  // Shnake system
  const {
    shnakes,
    shnakesRef,
    removeShnake,
    damageHead: damageShnakeHead,
    spawnOnTree,
    getTreeBlockIndexRefs,
  } = useShnakeSystem({
    definitions: shnakeDefinitions,
    plantedTrees,
    blocksRef,
    isEnabled: enemiesEnabled,
  });

  const { treeBlocksByTierRef, nonInvisTreeBlocksByTierRef } = getTreeBlockIndexRefs();

  // Track tree IDs to detect when trees are removed (for shnake cleanup)
  const prevTreeIdsRef = useRef<Set<string>>(new Set());

  // Clean up shnakes when their tree is removed (chopped)
  useEffect(() => {
    const currentTreeIds = new Set(plantedTrees.map(t => t.id));
    const prevTreeIds = prevTreeIdsRef.current;

    // Find trees that were removed
    for (const prevId of prevTreeIds) {
      if (!currentTreeIds.has(prevId)) {
        // Tree was removed - find and remove all shnakes on this tree
        const shnakesToRemove = shnakesRef.current.filter(s => s.treeId === prevId);
        for (const shnake of shnakesToRemove) {
          console.log(`[FortressScene] Removing shnake ${shnake.id.slice(-6)} from chopped tree ${prevId.slice(0, 8)}`);
          removeShnake(shnake.id);
        }
      }
    }

    // Update tracked tree IDs
    prevTreeIdsRef.current = currentTreeIds;
  }, [plantedTrees, shnakesRef, removeShnake]);
  
  // Shombie system
  const shombieRendererRef = useRef<ShombieRendererHandle>(null);
  
  const handleShombiePlayerHit = useCallback((damage: number, knockbackForce: number, direction: THREE.Vector3) => {
    // Defer to avoid render loop issues
    setTimeout(() => {
      // Use universal damage system if available (includes STEADY, armor, i-frames)
      if (applyDamageWithKnockback) {
        applyDamageWithKnockback(
          damage,
          direction.clone(),
          knockbackForce,
          { type: 'enemy', entityName: 'Shombie' }
        );
      } else if (takeDamage) {
        // Fallback to legacy function
        takeDamage(damage, direction.clone(), knockbackForce);
      }
      
      // Play player hit sound
      if (audioRefs.current.playerHit) {
        audioRefs.current.playerHit.currentTime = 0;
        audioRefs.current.playerHit.play().catch(() => {});
      }
    }, 0);
  }, [applyDamageWithKnockback, takeDamage]);
  
  const {
    shombies,
    shombiesRef,
    damageShombie,
    spawnShombieAt,
    spawnShombieGroup,
    spawningEnabled: shombieSpawningEnabled,
  } = useShombieSystem({
    definitions: shombieDefinitions,
    cameraRef,
    isEnabled: enemiesEnabled,
    userRoles,
    onShombieKilled,
    playerLevel,
  });

  // Shpider system — Phase 3 static. Spawn via Ctrl+P (admin) or
  // window.__spawnShpiders(tier, count) in the console.
  const { data: shpiderDefinitionsData } = useShpiderDefinitions();
  const shpiderDefinitions = shpiderDefinitionsData ?? [];
  const { shpidersRef, fragmentsRef: shpiderFragmentsRef, spawnShpiderGroup, spawnShpiderAt, damageShpider } = useShpiderSystem({
    definitions: shpiderDefinitions,
    cameraRef,
    isEnabled: enemiesEnabled,
    userRoles,
    onShpiderKilled,
  });

  // Shpider Egg system — eggs hatch into a tier-matched shpider on
  // rest. Phase 5 will turn the hatched mob into a pet (owner field +
  // friendly-target logic). For Phase 3 we just spawn a normal mob so
  // the throw/bounce/hatch path is testable end-to-end.
  const { eggsRef, throwEgg, tick: tickEggs } = useShpiderEggSystem({
    cameraRef,
    onHatch: ({ tier, position }) => {
      const def = shpiderDefinitions.find(d => d.tier === tier)
        ?? shpiderDefinitions[0];
      if (!def) return;
      spawnShpiderAt(def, position.x, position.z);
    },
  });
  const handleThrowEgg = useCallback((): boolean => {
    if (!consumeEgg) return false;
    const consumed = consumeEgg();
    if (!consumed) return false;
    return throwEgg(consumed.tier, consumed.eggInventoryRowId);
  }, [consumeEgg, throwEgg]);

  // Walapa system - floating whale creatures that travel between tall trees
  // Memoized: only recomputes when plantedTrees changes (not on every call)
  const eligibleTrees = useMemo(() => {
    return plantedTrees
      .filter(t => {
        if (typeof t.base_x !== 'number' || isNaN(t.base_x)) return false;
        if (typeof t.base_y !== 'number' || isNaN(t.base_y)) return false;
        if (typeof t.base_z !== 'number' || isNaN(t.base_z)) return false;
        if (Math.abs(t.base_x) > 10000 || Math.abs(t.base_y) > 1000 || Math.abs(t.base_z) > 10000) return false;
        return true;
      })
      .map(t => {
        const baseY = t.base_y ?? 0;
        const blockCount = t.current_block_count ?? 0;
        const treeHeight = Math.min(500, Math.max(10, Math.floor(blockCount / 5)));
        const topY = baseY + treeHeight;
        return {
          id: t.id,
          position: new THREE.Vector3(t.base_x, baseY, t.base_z),
          tier: t.seed_definition?.tier ?? 1,
          topY: topY,
        };
      });
  }, [plantedTrees]);
  const getEligibleTrees = useCallback(() => eligibleTrees, [eligibleTrees]);

  const {
    walapas,
    walapasRef,
    spawnWalapa,
    spawnWalapaAt,
    damageWalapa,
    updateMovement: updateWalapaMovement,
    addRider,
    removeRider,
  } = useWalapaSystem({
    definitions: walapaDefinitions,
    cameraRef,
    isEnabled: enemiesEnabled,
    getEligibleTrees,
    onWalapaKilled,
  });

  const walapaRendererRef = useRef<WalapaRendererHandle>(null);

  // Shtickman system - tall stick humanoids that wander
  const shtickmanRendererRef = useRef<ShtickmanRendererHandle>(null);

  const {
    shtickmen,
    shtickmenRef,
    spawnShtickmanByTier,
    damageShtickman,
    updateMovement: updateShtickmanMovement,
  } = useShtickmanSystem({
    definitions: shtickmanDefinitions,
    cameraRef,
    isEnabled: enemiesEnabled,
    plantedTrees,
    onShtickmanKilled,
  });

  // Shnake player hit callback - uses universal damage system
  // shnakeId is optional for compatibility with legacy system
  const handleShnakePlayerHit = useCallback((damage: number, knockbackForce: number, direction: THREE.Vector3, shnakeId?: string) => {
    // Defer to avoid render loop issues
    setTimeout(() => {
      // Use universal damage system if available (includes STEADY, armor, i-frames)
      if (applyDamageWithKnockback) {
        applyDamageWithKnockback(
          damage,
          direction.clone(),
          knockbackForce,
          { type: 'enemy', entityName: 'Shnake' }
        );
      } else if (takeDamage) {
        // Fallback to legacy function
        takeDamage(damage, direction.clone(), knockbackForce);
      }
      
      // Record revenge damage dealt by this shnake
      if (shnakeId) {
        recordShnakeRevengeDamage(shnakeId, damage);
        console.log(`[Shnake Attack] Shnake ${shnakeId} dealt ${damage} revenge damage`);
      }
      
      // Play player hit sound
      if (audioRefs.current.playerHit) {
        audioRefs.current.playerHit.currentTime = 0;
        audioRefs.current.playerHit.play().catch(() => {});
      }
    }, 0);
  }, [applyDamageWithKnockback, takeDamage]);

  // Fire propagation callback - when shnake head moves, propagate fire toward head
  const handleShnakeHeadMoved = useCallback((shnakeId: string) => {
    shnakeRendererRef.current?.propagateFire(shnakeId);
  }, []);
  
  // Indignant callbacks - when shnake body is hit (no damage), play roar and wiggle
  const lastRoarTimeRef = useRef<Record<string, number>>({});
  const handleIndignantRoar = useCallback((shnakeId: string, volume: number) => {
    const now = Date.now();
    const lastTime = lastRoarTimeRef.current[shnakeId] || 0;
    if (now - lastTime < 2500) return; // Cooldown: skip if roared < 2.5s ago
    lastRoarTimeRef.current[shnakeId] = now;
    playSpatialSound('/shnake_sound_1.mp3', 10, { baseVolume: 0.5 * volume });
  }, []);
  
  const handleTriggerWiggle = useCallback((shnakeId: string) => {
    // Trigger S-formation wiggle animation in ShnakeRenderer
    shnakeRendererRef.current?.triggerWiggle(shnakeId);
    console.log(`[Shnake] Trigger wiggle for ${shnakeId}`);
  }, []);

  useShnakeMovement({
    shnakesRef,
    cameraRef,
    plantedTrees,
    blocksRef,
    isEnabled: enemiesEnabled,
    aiControlled: AI_CONTROLLED,
    treeBlocksByTierRef,
    nonInvisTreeBlocksByTierRef,
    onPlayerHit: handleShnakePlayerHit,
    onHeadMoved: handleShnakeHeadMoved,
  });

  // Admin spawn callback: spawn shnake on nearest tree
  const handleSpawnShnake = useCallback((tier: number) => {
    if (!plantedTrees || plantedTrees.length === 0) {
      console.log('[SpawnShnake] No trees available');
      return;
    }
    
    const camPos = cameraRef.current?.position;
    if (!camPos) return;
    
    // Single-pass: find nearest tree matching tier, and nearest any tree as fallback
    let nearestTierTree: typeof plantedTrees[0] | null = null;
    let nearestTierDist = Infinity;
    let nearestAnyTree: typeof plantedTrees[0] | null = null;
    let nearestAnyDist = Infinity;

    for (const tree of plantedTrees) {
      const dx = tree.base_x - camPos.x;
      const dz = tree.base_z - camPos.z;
      const dist = dx * dx + dz * dz;

      if (dist < nearestAnyDist) {
        nearestAnyDist = dist;
        nearestAnyTree = tree;
      }

      const treeTier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
      if (treeTier === tier && dist < nearestTierDist) {
        nearestTierDist = dist;
        nearestTierTree = tree;
      }
    }

    const nearestTree = nearestTierTree ?? nearestAnyTree;
    
    if (nearestTree) {
      const treeTier = (nearestTree as any).seed_tier ?? nearestTree.seed_definition?.tier ?? 1;
      console.log(`[SpawnShnake] Spawning shnake on T${treeTier} tree at (${nearestTree.base_x}, ${nearestTree.base_z})`);
      const result = spawnOnTree(nearestTree);
      if (result) {
        console.log(`[SpawnShnake] Success! Shnake ${result.id} with ${result.segments.length} segments`);
      } else {
        console.log('[SpawnShnake] Failed - no valid spawn position');
      }
    } else {
      console.log('[SpawnShnake] No trees found');
    }
  }, [plantedTrees, cameraRef, spawnOnTree]);
  
  // Universal spawn command system - handles !1##, !2##, !3##
  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');
  
  const spawnCallbacks = useMemo(() => ({
    onSpawnShwarm: (tier: number) => {
      console.log(`[SpawnCommands] Spawning shwarm tier ${tier}`);
      spawnShwarmByTier(tier);
    },
    onSpawnShnake: (tier: number) => {
      console.log(`[SpawnCommands] Spawning shnake tier ${tier}`);
      handleSpawnShnake(tier);
    },
    onSpawnShombie: (tier: number, count: number) => {
      console.log(`[SpawnCommands] Spawning ${count} shombie(s) tier ${tier}`);
      spawnShombieGroup(tier, count);
    },
    onSpawnWalapa: (tier: number) => {
      console.log(`[SpawnCommands] Spawning walapa tier ${tier}`);
      spawnWalapa(tier);
    },
    onSpawnShtickman: (tier: number) => {
      console.log(`[SpawnCommands] Spawning shtickman tier ${tier}`);
      spawnShtickmanByTier(tier);
    },
    onSpawnShpider: (tier: number, count: number) => {
      console.log(`[SpawnCommands] Spawning ${count} shpider(s) tier ${tier}`);
      spawnShpiderGroup(tier, count);
    },
  }), [spawnShwarmByTier, handleSpawnShnake, spawnShombieGroup, spawnWalapa, spawnShtickmanByTier, spawnShpiderGroup]);
  
  useSpawnCommands({
    isEnabled: true,
    isAdmin,
    callbacks: spawnCallbacks,
  });

  // Universal Enemy Spawner (UES) - handles natural spawning for all enemy types
  // Get isNight from cycle state ref
  const isNightRef = useRef(false);

  // UES spawn callbacks
  const handleUESSpawnShwarm = useCallback((definition: any, worldX: number, worldZ: number) => {
    spawnShwarmAt(definition, worldX, worldZ);
  }, [spawnShwarmAt]);

  const handleUESSpawnShombie = useCallback((definition: any, worldX: number, worldZ: number) => {
    spawnShombieAt(definition, worldX, worldZ);
  }, [spawnShombieAt]);

  // UES integration - natural spawning for Shwarms and Shombies
  useEnemySpawnerIntegration({
    isEnabled: enemiesEnabled, // Delay until blocks loaded
    cameraRef,
    isNight: isNightRef.current,
    playerLevel,
    isPlayerInTree: false, // TODO: implement tree detection
    isPlayerOnGround: true, // TODO: get from controls
    shwarmDefinitions,
    shwarmsRef,
    onSpawnShwarm: handleUESSpawnShwarm,
    shombieDefinitions,
    shombiesRef,
    onSpawnShombie: handleUESSpawnShombie,
  });

  // Universal Enemy AI system - only enabled when AI_CONTROLLED is true
  // When false, legacy movement hooks handle everything (no double-overhead)
  const { isAIControlled } = useEnemyAI({
    cameraRef,
    shnakesRef,
    shwarmsRef,
    shombiesRef,
    walapasRef,
    shtickmenRef,
    isEnabled: ENABLE_ENEMY_AI,
    aiControlled: AI_CONTROLLED,
    plantedTrees,
    blocksRef,
    treeBlocksByTierRef,
    onPlayerHit: handleShnakePlayerHit,
    onShnakeHeadMoved: handleShnakeHeadMoved,
    onIndignantRoar: handleIndignantRoar,
    onTriggerWiggle: handleTriggerWiggle,
    onShombiePlayerHit: handleShombiePlayerHit,
  });
  
  const shwarmRendererRef = useRef<ShwarmRendererHandle>(null);
  const shnakeRendererRef = useRef<ShnakeRendererHandle>(null);
  
  // Shared cycle state ref for weather/sky/lighting
  const cycleStateRef = useRef({
    lightingPercentage: weatherSettings.lightingRange[0],
    cyclePosition: 0,
    isNight: false
  });
  
  // Bullet system - use refs to avoid useFrame setState
  // Uses object pool to avoid GC allocations
  
  // Pre-allocate bullet pool to avoid per-shot allocations
  const bulletPoolRef = useRef<BulletLocal[]>(
    Array.from({ length: MAX_BULLETS }, () => ({
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      velocityY: 0,
      speed: 100,
      life: 0,
      tier: 1,
      color: '#FFFF00',
      ricochetScale: 1.0,
      isPentabullet: false
    }))
  );
  const activeBulletCount = useRef(0);
  const bulletsRef = useRef<BulletLocal[]>([]);
  const [bulletRenderTrigger, setBulletRenderTrigger] = useState(0);
  const lastBulletRender = useRef(0);
  
  const [showCrosshairs, setShowCrosshairs] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  
  // Track right-click for aiming
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2 && crosshairsEnabled) {
        setIsAiming(true);
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        setIsAiming(false);
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [crosshairsEnabled]);
  
  useEffect(() => {
    if (!crosshairsEnabled) {
      setIsAiming(false);
    }
  }, [crosshairsEnabled]);
  
  // Audio
  const lastAudioTime = useRef(0);
  const AUDIO_THROTTLE = 100;
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRefs = useRef(createAudioRefs());
  
  const { scene, gl } = useThree();
  // Make the renderer/scene/camera available to shaderWarmup, which is
  // triggered from usePlacedBlocksWithCache before the loading screen
  // dismisses.
  useEffect(() => {
    registerWarmupContext(gl, scene, camera);
  }, [gl, scene, camera]);
  const { raycastMeshes } = useRaycaster();
  
  // Instanced mesh refs for raycasting
  const instancedMeshesRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const meshesArrayCache = useRef<THREE.InstancedMesh[]>([]);
  const meshToBlockTypeCache = useRef<Map<THREE.InstancedMesh, string>>(new Map());
  const blocksByTypeAndUser = useRef<Map<string, PlacedBlock[]>>(new Map());
  
  // Wisp block system
  const { blocks: allBlocks, blocksMap } = useBlocksData();
  const basicBlocks = useMemo(() => 
    allBlocks.filter(block => block.class === 'basic'),
    [allBlocks]
  );
  // Store blocksMap in ref to access in useFrame without stale closures
  const blocksMapRef = useRef(blocksMap);
  blocksMapRef.current = blocksMap;
  const { wispState, wispPositionRef, collectWisp } = useWispBlock(basicBlocks, blocks);
  const wispMeshRef = useRef<THREE.Mesh | null>(null);
  
  // Wisp particles - use refs to avoid useFrame setState
  const wispParticlesRef = useRef<WispParticle[]>([]);
  const wispParticlesMeshRef = useRef<WispParticlesMeshHandle>(null);
  const [wispRenderTrigger, setWispRenderTrigger] = useState(0);
  const lastWispRender = useRef(0);
  
  // Refs for consolidated components (avoid separate useFrame hooks)
  const bulletsComponentRef = useRef<BulletsHandle>(null);
  const lightingRef = useRef<LightingHandle>(null);
  const skyRef = useRef<SkyHandle>(null);
  const fpsCounterRef = useRef<FPSCounterHandle>(null);
  const bulletImpactsRef = useRef<BulletImpactsHandle>(null);
  const nebulaImpactsRef = useRef<NebulaImpactsHandle>(null);
  const tracersRef = useRef<TracersHandle>(null);
  const jetBoostFXRef = useRef<JetBoostFXHandle>(null);
  const universalFlameRef = useRef<UniversalFlameRendererHandle>(null);
  const { flameDemoRef, fruitVisibility } = useAdminPanel();

  // Grenade system. Owns live grenades + their physics; explosion VFX
  // routes through universalFlameRef. The throw flow goes:
  //   FortressControls (G + click) → onThrowGrenade()
  //     → consumeGrenade() (Fortress.tsx, inventory)
  //     → grenadeSystem.throwGrenade(tier) (this hook)
  //
  // applyBurnRef is populated by a useEffect below once burnSystem is
  // created — hook order makes the burn system mount AFTER the
  // grenade system, so we pass a ref and back-fill it.
  const applyBurnRef = useRef<((...args: any[]) => void) | null>(null);
  const explosionFxRef = useRef<ExplosionFXHandle | null>(null);
  const { grenadesRef, throwGrenade } = useGrenadeSystem({
    universalFlameRef,
    cameraRef,
    applyBurnRef: applyBurnRef as React.RefObject<any>,
    explosionFxRef,
  });
  const handleThrowGrenade = useCallback((): boolean => {
    if (!consumeGrenade) return false;
    const tier = consumeGrenade();
    if (tier == null) return false;
    return throwGrenade(tier);
  }, [consumeGrenade, throwGrenade]);

  // (Flame Glove setup is below, after getDefinition is available)

  // Track meshes by a unique ID (mesh reference) to allow multiple meshes per blockType
  // This is needed because tree blocks share the same type ("trunk") but have different textures
  const meshIdCounter = useRef(0);
  const meshToIdRef = useRef(new WeakMap<THREE.InstancedMesh, string>());
  
  const handleMeshReady = useCallback((blockType: string, mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      // Generate a unique ID for this mesh if it doesn't have one
      let meshId = meshToIdRef.current.get(mesh);
      if (!meshId) {
        meshId = `${blockType}_${meshIdCounter.current++}`;
        meshToIdRef.current.set(mesh, meshId);
      }
      
      instancedMeshesRef.current.set(meshId, mesh);
      meshToBlockTypeCache.current.set(mesh, blockType);
      meshesArrayCache.current = Array.from(instancedMeshesRef.current.values());
    } else {
      // Unmount (mesh=null). Previously this only cleaned the string-
      // keyed `instancedMeshesRef` map, leaving `meshToBlockTypeCache`
      // (Mesh-KEYED Map) holding strong refs to the unmounted meshes
      // forever → each mesh's Float32Arrays (~300KB) couldn't be GC'd.
      // With 500+ unmounts per session that alone leaked ~150MB.
      // Now: collect all matching stale meshes, then purge from BOTH
      // maps (and the WeakMap, explicitly, even though it'd clear when
      // the mesh becomes unreachable).
      const stale: THREE.InstancedMesh[] = [];
      const staleKeys: string[] = [];
      for (const [key, storedMesh] of instancedMeshesRef.current.entries()) {
        if (key.startsWith(blockType + '_')) {
          stale.push(storedMesh);
          staleKeys.push(key);
        }
      }
      for (const k of staleKeys) instancedMeshesRef.current.delete(k);
      for (const m of stale) {
        meshToBlockTypeCache.current.delete(m);
        meshToIdRef.current.delete(m);
      }
      meshesArrayCache.current = Array.from(instancedMeshesRef.current.values());
    }
  }, []);

  // Fog configuration — lightning panel overrides profile value for instant control
  const { visualDistance, fogEnabled: profileFogEnabled } = useBlocks();
  const fogEnabled = lightningSettings?.fogEnabled ?? profileFogEnabled;
  // Scope multiplayer by world - prevents cross-world player visibility
  const { players, broadcastPosition, broadcastPlayerHit, isConnected, localPlayerOnFire, localFireBurnTimeMs, localFireColors, setLocalPlayerOnFire } = useMultiplayer(currentWorldId);
  const { user } = useAuth();
  
  // Refs for player collision detection
  const playersRef = useRef(players);
  playersRef.current = players;
  
  // Removed black background - was causing sky issues

  // Day/night fog colors — use lightning panel overrides if available
  const lsFogStartPct = lightningSettings?.fogStartPct ?? 30;
  const lsFogEndPct = lightningSettings?.fogEndPct ?? 85;
  const lsFogDayColor = lightningSettings?.fogDayColor ?? '#cccccc';
  const lsFogNightColor = lightningSettings?.fogNightColor ?? '#222233';
  const lsFreezeCycle = lightningSettings?.freezeCycle ?? false;
  const lsLightingOverride = lightningSettings?.lightingOverride ?? null;

  const fogColorDay = useMemo(() => new THREE.Color(lsFogDayColor), [lsFogDayColor]);
  const fogColorNight = useMemo(() => new THREE.Color(lsFogNightColor), [lsFogNightColor]);
  const fogColorCurrent = useRef(new THREE.Color(lsFogDayColor));

  useEffect(() => {
    if (fogEnabled) {
      // Fog overhaul Phase 1+2 (docs/FOG_PLAN.md): dense exponential fog,
      // height-aware. fogState.density is updated each frame by the
      // height-fog callback below.
      scene.fog = new THREE.FogExp2(fogColorCurrent.current, fogState.density);
      scene.background = fogColorCurrent.current.clone();
    } else {
      scene.fog = null;
      scene.background = null;
    }
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene, fogEnabled]);

  // Height-aware fog: recompute density + render distance from camera.y
  // (throttled ~200ms via frameLoop). The chunk-visibility memo picks up
  // fogState.distChunks on its own re-runs.
  useEffect(() => {
    if (!fogEnabled) return;
    let lastUpdate = 0;
    const unregister = frameLoop.register('fogHeight', () => {
      const now = performance.now();
      if (now - lastUpdate < 200) return;
      lastUpdate = now;
      updateFogForHeight(camera.position.y);
      if (scene.fog && 'density' in scene.fog) {
        (scene.fog as THREE.FogExp2).density = fogState.density;
      }
    }, 50);
    return unregister;
  }, [scene, camera, fogEnabled]);

  // Update fog color based on day/night cycle (low frequency — every 500ms)
  useEffect(() => {
    if (!fogEnabled) return;
    const interval = setInterval(() => {
      if (!scene.fog) return;
      // Use manual override if set, otherwise use cycle state
      const lp = (lsLightingOverride !== null ? lsLightingOverride : cycleStateRef.current.lightingPercentage) / 100;
      fogColorCurrent.current.copy(fogColorNight).lerp(fogColorDay, lp);
      (scene.fog as THREE.Fog).color.copy(fogColorCurrent.current);
      if (scene.background instanceof THREE.Color) {
        scene.background.copy(fogColorCurrent.current);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [scene, fogEnabled, fogColorDay, fogColorNight, lsLightingOverride]);

  // Initialize audio
  useEffect(() => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    } catch (e) {
      console.warn('Web Audio API not supported');
    }

    initializeAudioElements(audioRefs.current as unknown as Record<string, HTMLAudioElement>);
    
    // Preload spatial audio sounds
    preloadSpatialSounds([getSoundUrl('ricochet', '/ricochet_sound.mp3')]);

    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    const now = Date.now();
    if (now - lastAudioTime.current < AUDIO_THROTTLE) return;

    try {
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      if (audio.readyState >= 2) {
        audio.currentTime = 0;
        await audio.play();
        lastAudioTime.current = now;
      }
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }, []);

  // Persistent raycaster for wisp hit detection - avoid GC pressure
  const wispRaycaster = useRef(new THREE.Raycaster());
  const wispRayDirection = useRef(new THREE.Vector3());
  
  // Check for wisp hits
  const checkWispHit = useCallback(async () => {
    if (!wispMeshRef.current || !wispState) return false;

    diagnostics.e3++; // Track raycast call
    wispRayDirection.current.set(0, 0, -1);
    wispRayDirection.current.applyQuaternion(camera.quaternion);
    wispRaycaster.current.set(camera.position, wispRayDirection.current);

    const intersects = wispRaycaster.current.intersectObject(wispMeshRef.current);
    if (intersects.length > 0 && intersects[0].distance < 100) {
      const collectedBlock = collectWisp();
      if (collectedBlock) {
        // Play sound and particles IMMEDIATELY (before server round-trip)
        playSpatialSound('/wisp_death.mp3', 0, { baseVolume: 0.6 });

        const explosionPos = wispPositionRef.current.clone();
        const newParticles: WispParticle[] = [];
        const particleCount = 8;

        // 8 mini-wisps with individual speed variation (±50%)
        for (let i = 0; i < particleCount; i++) {
          const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
          const elevation = (Math.random() - 0.3) * Math.PI * 0.8; // More upward bias
          const baseSpeed = 4 + Math.random() * 6;
          const speedMultiplier = 0.5 + Math.random(); // 0.5 to 1.5 (±50%)
          const speed = baseSpeed * speedMultiplier;

          newParticles.push({
            position: explosionPos.clone(),
            velocity: new THREE.Vector3(
              Math.cos(angle) * Math.cos(elevation) * speed,
              Math.sin(elevation) * speed + 2, // Extra upward boost
              Math.sin(angle) * Math.cos(elevation) * speed
            ),
            life: 1,
            color: collectedBlock.properties?.color || '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            scale: 0.25 // 1/4 diameter of normal wisp
          });
        }
        wispParticlesRef.current.push(...newParticles);
        setWispRenderTrigger(prev => prev + 1);

        // Server confirmation (non-blocking for UX)
        const success = await collectWispBlock(collectedBlock.key);

        if (success) {
          toast({
            title: "✨ Wisp Block Collected!",
            description: `You found a ${collectedBlock.name}!`,
            duration: 3000
          });

          return true;
        }
      }
    }
    return false;
  }, [wispState, camera, collectWisp, collectWispBlock, wispPositionRef, playAudio, toast]);

  // Get bullet definitions for impact effects - use ref to avoid stale closure in useFrame
  const { getDefinition } = useBulletDefinitions();
  const getDefinitionRef = useRef(getDefinition);
  getDefinitionRef.current = getDefinition;

  const { handleShoot } = useFortressShooting({
    checkWispHit,
    selectedBulletTier,
    bulletPoolRef,
    activeBulletCount,
    bulletsRef,
    tracersRef,
    setBulletRenderTrigger,
    setShowCrosshairs,
    getDefinitionRef,
    camera,
  });

  

  useFortressFrameLoop({
    camera,
    skyRef,
    lightingRef,
    bulletsComponentRef,
    wispParticlesMeshRef,
    fpsCounterRef,
    tracersRef,
    wispParticlesRef,
    setWispRenderTrigger,
    lastWispRender,
    bulletsRef,
    bulletPoolRef,
    setBulletRenderTrigger,
    lastBulletRender,
    bulletImpactsRef,
    nebulaImpactsRef,
    getDefinitionRef,
    onCoinHit,
    playAudio,
    audioRefs,
    blocksMapRef,
    blocks,
    shwarmsRef,
    shwarmRendererRef,
    damageBlock,
    onPointsEarned,
    shnakeRendererRef,
    shnakesRef,
    damageShnakeHead,
    onShnakeKilled,
    shombiesRef,
    shombieRendererRef,
    damageShombie,
    walapasRef,
    updateWalapaMovement,
    shtickmenRef,
    damageShtickman,
    updateShtickmanMovement,
    shpidersRef,
    damageShpider,
    isAIControlled,
    useNebulaForBulletImpacts: USE_NEBULA_FOR_BULLET_IMPACTS,
    debugBullets: DEBUG_BULLETS,
  });

  // Flame Glove / Flamethrower system
  const isFlameGloveSelected = selectedItemDef?.name?.toLowerCase().includes('flame glove') ?? false;
  const flameGloveTier = selectedItemDef?.tier ?? 1;
  const ftTiers = useFlamethrowerTiers();
  const ftTierDef = ftTiers.getDefinition(flameGloveTier);

  // Level-based distance bonus: +0.33m per level (level 12 ≈ +4m)
  const flameLevelBonus = Math.floor(playerLevel * 0.33);
  const flameDistance = ftTierDef.distance + flameLevelBonus;

  const flamethrower = useFlamethrower({
    color1: ftTierDef.color1,
    color2: ftTierDef.color2,
    color3: ftTierDef.color3,
    fireOpacity: ftTierDef.fireOpacity,
    smokeOpacity: ftTierDef.smokeOpacity,
    distance: flameDistance,
    tier: flameGloveTier,
    width: ftTierDef.width,
    speed: ftTierDef.speed,
    particles: ftTierDef.particles,
    transparency: ftTierDef.transparency,
  });

  const flamethrowerRef = useRef(flamethrower);
  flamethrowerRef.current = flamethrower;

  const handleFlameStart = useCallback(() => {
    if (isFlameGloveSelected) {
      flamethrowerRef.current.startFlame();
    }
  }, [isFlameGloveSelected]);

  const handleFlameStop = useCallback(() => {
    flamethrowerRef.current.stopFlame();
  }, []);

  // Flame Glove damage: apply continuous cone damage to enemies while flamethrower is active
  const flameDamageTickRef = useRef(0);
  const _flameDirVec = useRef(new THREE.Vector3());
  const _flameEnemyDir = useRef(new THREE.Vector3());
  const _flameTmpPos = useRef(new THREE.Vector3());
  // Ref for flame config values accessible in frame loop
  const configRef_flame = useRef({
    tier: flameGloveTier,
    distance: flameDistance,
    colors: [ftTierDef.color1, ftTierDef.color2, ftTierDef.color3] as [string, string, string],
    colorMode: (flameGloveTier === 8 ? 'rainbow' : 'static') as import('./UniversalFlameRenderer').FlameColorMode,
  });
  configRef_flame.current = {
    tier: flameGloveTier,
    distance: flameDistance,
    colors: [ftTierDef.color1, ftTierDef.color2, ftTierDef.color3] as [string, string, string],
    colorMode: (flameGloveTier === 8 ? 'rainbow' : 'static') as import('./UniversalFlameRenderer').FlameColorMode,
  };

  // Universal burn-over-time system for flamethrower DOT. The burn
  // system now talks to every monster via the EnemyCombatRegistry, so
  // adding a new monster doesn't require touching this hook — only
  // its adapter needs to be registered.
  const burnSystem = useBurnSystem({
    universalFlameRef,
    cameraRef,
    takeDamage,
  });
  // Back-fill the grenade system's burn ref. Hook order requires
  // useGrenadeSystem to be defined before useBurnSystem, so the
  // grenade hook accepts a ref it can read at explosion time.
  applyBurnRef.current = burnSystem.applyBurn;

  useFrame((_, delta) => {
    if (!flamethrower.isActiveRef.current) return;

    flameDamageTickRef.current += delta;
    if (flameDamageTickRef.current < 0.1) return; // 100ms tick rate
    const tickDelta = flameDamageTickRef.current;
    flameDamageTickRef.current = 0;

    const { tier, distance, colors, colorMode } = configRef_flame.current;
    const dps = 10 * tier;
    const tickDamage = Math.round(dps * tickDelta);
    if (tickDamage <= 0) return;
    // Tier-scaled burn duration. T1 = 5s, T10 = 14s. Higher tier
    // weapons make the residual flame stick around longer for more
    // total DOT damage.
    const burnSecondsForTier = 5 + (tier - 1);

    // Flame direction from camera
    const origin = camera.position;
    const dir = _flameDirVec.current.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const halfAngle = Math.PI / 9; // ~20 degrees — matches visual flame spread

    // Helper: check if a position is within flame cone
    const isInCone = (pos: THREE.Vector3): boolean => {
      const toEnemy = _flameEnemyDir.current.copy(pos).sub(origin);
      const dist = toEnemy.length();
      if (dist > distance || dist < 0.5) return false;
      toEnemy.normalize();
      const angle = Math.acos(Math.min(1, dir.dot(toEnemy)));
      return angle <= halfAngle;
    };

    // Universal cone pass — iterate every adapter in the
    // EnemyCombatRegistry. For tall enemies (shtickman is 22–40m) a
    // single hitbox-center test misses the feet/head; sample at a
    // fixed ~3m step so the cone's narrowest reach (~6m at max
    // distance) can't slip between samples. Shwarm exposes one
    // entry per block, so each block's tiny hitbox gets tested
    // independently with a single-sample pass.
    const CONE_SAMPLE_STEP = 3.0;
    for (const adapter of enemyCombatRegistry.getAdapters()) {
      for (const enemy of adapter.getActiveEnemies()) {
        const hb = adapter.getHitbox(enemy);
        if (!hb) continue;
        const heightSpan = hb.topY - hb.bottomY;
        const sampleCount = heightSpan > CONE_SAMPLE_STEP
          ? Math.max(2, Math.ceil(heightSpan / CONE_SAMPLE_STEP) + 1)
          : 1;
        let hitX = 0, hitY = 0, hitZ = 0;
        let coneHit = false;
        for (let s = 0; s < sampleCount; s++) {
          const t = sampleCount === 1 ? 0.5 : s / (sampleCount - 1);
          const py = hb.bottomY + heightSpan * t;
          _flameTmpPos.current.set(hb.centerX, py, hb.centerZ);
          if (isInCone(_flameTmpPos.current)) {
            hitX = hb.centerX; hitY = py; hitZ = hb.centerZ;
            coneHit = true;
            break;
          }
        }
        if (!coneHit) continue;

        adapter.applyDamage(enemy, {
          damage: tickDamage,
          bulletSpeed: 0,
          knockbackDirX: 0, knockbackDirY: 0, knockbackDirZ: 0,
          hitX, hitY, hitZ,
          isHeadshot: false,
          source: 'flame',
        });
        // Compound id for shwarm becomes "<shwarmId>::<blockId>". The
        // burn system expects shwarm as (entityId, blockId), so split.
        let burnEntityId: string;
        let burnBlockId: string | undefined;
        const compoundId = adapter.getId(enemy);
        if (adapter.type === 'shwarm') {
          const idx = compoundId.indexOf('::');
          burnEntityId = idx >= 0 ? compoundId.slice(0, idx) : compoundId;
          burnBlockId = idx >= 0 ? compoundId.slice(idx + 2) : undefined;
        } else {
          burnEntityId = compoundId;
          burnBlockId = undefined;
        }
        _flameTmpPos.current.set(hitX, hitY, hitZ);
        burnSystem.applyBurn(
          adapter.type,
          burnEntityId,
          burnBlockId,
          tier, colors, colorMode, tickDamage, 0,
          _flameTmpPos.current,
          burnSecondsForTier,
        );
      }
    }
  });

  return (
    <>
      <FirstPersonControls
        onShoot={handleShoot}
        showCrosshairs={crosshairsEnabled}
        audioRefs={audioRefs.current}
        playAudio={playAudio}
        blockPlacementMode={blockPlacementMode}
        treePlacementMode={treePlacementMode}
        fungalPlacementMode={fungalPlacementMode}
        widePlacementMode={widePlacementMode}
        onBlockPlace={onBlockPlace}
        onTreePlace={onTreePlace}
        onFungalTreePlace={onFungalTreePlace}
        onWideTreePlace={onWideTreePlace}
        onOpenPanel={onOpenPanel}
        onOpenMarketplace={onOpenMarketplace}
        onToggleInventory={onToggleInventory}
        onModeChange={onModeChange}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        selectedSeedTier={selectedSeedTier}
        selectedFungalTier={selectedFungalTier}
        selectedWideTier={selectedWideTier}
        panelOpen={panelOpen}
        onCycleBlock={onCycleBlock}
        onCycleSeed={onCycleSeed}
        onCycleFungalSeed={onCycleFungalSeed}
        onCycleWideSeed={onCycleWideSeed}
        blocks={blocks}
        onBlockRain={onBlockRain}
        userRoles={userRoles}
        broadcastPosition={broadcastPosition}
        onBlockRemove={onBlockRemove}
        showOwnershipOutline={showOwnershipOutline}
        currentUserId={currentUserId}
        hoveredBlockId={hoveredBlockId}
        setHoveredBlockId={setHoveredBlockId}
        instancedMeshesRef={instancedMeshesRef}
        meshesArrayCache={meshesArrayCache}
        meshToBlockTypeCache={meshToBlockTypeCache}
        blocksByTypeAndUser={blocksByTypeAndUser}
        onGodModeChange={onGodModeChange}
        updatePlayerPosition={updatePlayerPosition}
        respawnPosition={respawnPosition}
        onRespawnComplete={onRespawnComplete}
        isOwnedTreeAtPosition={isOwnedTreeAtPosition}
        onTreeChopComplete={onTreeChopComplete}
        onTreeChopProgress={onTreeChopProgress}
        onBlockMineComplete={onBlockMineComplete}
        onBulletTierChange={onBulletTierChange}
        playerLevel={playerLevel}
        onPentabulletChargeChange={onPentabulletChargeChange}
        onUseHotbarSlot={onUseHotbarSlot}
        onThrowGrenade={handleThrowGrenade}
        onGrenadeTogglePress={onGrenadeTogglePress}
        grenadeReady={grenadeReady}
        onThrowEgg={handleThrowEgg}
        onEggTogglePress={onEggTogglePress}
        eggReady={eggReady}
        onHealthPotionUse={onHealthPotionUse}
        onAdminGrantGrenade={onAdminGrantGrenade}
        onAdminGrantHealthPotion={onAdminGrantHealthPotion}
        onOpenVault={vaultInRange ? onOpenVault : undefined}
        onSpawnShnake={handleSpawnShnake}
        onJetBoostStateChange={onJetBoostStateChange}
        onJetBoostFired={(pos, colors) => {
          // Get colors from bullet tier definition if not provided
          const effectColors = colors.length > 0 ? colors : (getDefinition(selectedBulletTier)?.colors || ['#FF6600', '#FF3300']);
          jetBoostFXRef.current?.spawnJetBoost(pos, effectColors);
        }}
        bulletTier={selectedBulletTier}
        walapasRef={walapasRef}
        isFlameGloveSelected={isFlameGloveSelected}
        onFlameStart={handleFlameStart}
        onFlameStop={handleFlameStop}
        onHarvestFruit={harvestNearest}
        checkIsInWater={worldPonds.checkIsInWater}
        getWaterType={worldPonds.getWaterType}
        loadedChunksRef={chunksRef}
        currentWorldId={currentWorldId}
      />
      
      <MultiplayerPlayers players={players} />
      <LocalPlayerAvatar isGunEquipped={crosshairsEnabled} />
      <FirstPersonArms isGunEquipped={crosshairsEnabled} isAiming={isAiming} />
      <FortressJetBoostFX ref={jetBoostFXRef} getDefinition={getDefinition} bulletTier={selectedBulletTier} />
      <SceneReflections />
      
      <DynamicLighting ref={lightingRef} cycleStateRef={cycleStateRef} />
      <DynamicSky ref={skyRef} weatherSettings={weatherSettings} cycleStateRef={cycleStateRef} skyTextureUrl={skyTextureUrl} freezeCycle={lsFreezeCycle} lightingOverride={lsLightingOverride} />

      <FortressStructure fortressTextureUrl={fortressTextureUrl} groundTextureUrl={groundTextureUrl} />
      {/* <FortressParticles /> */}
      <BillboardWalls wallPositions={wallPositions} isMoveMode={isMoveMode} />
      <CameraTrackedBlocks
        showOwnershipOutline={showOwnershipOutline && blockPlacementMode}
        currentUserId={user?.id}
        hoveredBlockId={hoveredBlockId}
        onMeshReady={handleMeshReady}
        performanceMode={performanceMode}
        groundTextureUrl={groundTextureUrl}
        viewSettings={viewSettings}
      />
      <Waterfall
        flowSpeed={settings.flowSpeed} 
        msBetweeenDrops={settings.msBetweeenDrops} 
        colorPalette={settings.colorPalette}
        enabled={waterfallEnabled}
      />
      <Coins 
        coinRate={settings.coinRate} 
        coinSize={settings.coinSize} 
        flowSpeed={settings.flowSpeed}
        onGetCoins={() => []}
        coinImageUrl={coinImageUrl}
      />
      <Bullets ref={bulletsComponentRef} bullets={bulletsRef.current} />
      <BulletImpacts ref={bulletImpactsRef} />
      <NebulaImpacts ref={nebulaImpactsRef} />
      <Tracers ref={tracersRef} />
      <UniversalFlameRenderer ref={universalFlameRef} />
      <FlameDemoSpawner ref={flameDemoRef} bulletImpactsRef={bulletImpactsRef} universalFlameRef={universalFlameRef} />

      {wispState && (
        <WispBlock 
          positionRef={wispPositionRef}
          blockType={wispState.blockType}
          onMeshReady={(mesh) => { wispMeshRef.current = mesh; }}
        />
      )}
      
      <WispParticlesMesh ref={wispParticlesMeshRef} particles={wispParticlesRef.current} renderTrigger={wispRenderTrigger} />
      
      {/* Shwarm Renderer */}
      <ShwarmRenderer ref={shwarmRendererRef} shwarms={shwarms} universalFlameRef={universalFlameRef} />

      {/* Shnake Renderer */}
      <ShnakeRenderer ref={shnakeRendererRef} shnakesRef={shnakesRef} cameraRef={cameraRef} universalFlameRef={universalFlameRef} />
      
      {/* Shombie Renderer - uses UniversalFlameRenderer for head fires */}
      <ShombieRenderer ref={shombieRendererRef} shombies={shombies} universalFlameRef={universalFlameRef} />

      {/* Walapa Renderer - floating whale creatures */}
      <WalapaRenderer ref={walapaRendererRef} walapas={walapas} cameraRef={cameraRef} />

      {/* Shtickman Renderer - tall stick humanoids */}
      <ShtickmanRenderer ref={shtickmanRendererRef} shtickmenRef={shtickmenRef} cameraRef={cameraRef} universalFlameRef={universalFlameRef} />

      {/* Shpider Renderer — per-tier InstancedMesh routing + death fragments. */}
      <ShpiderRenderer
        shpidersRef={shpidersRef}
        fragmentsRef={shpiderFragmentsRef}
        cameraRef={cameraRef}
        definitions={shpiderDefinitions}
        onPlayerHit={handleShpiderPlayerHit}
      />

      {/* Grenade Renderer — instanced spheres for live grenades. */}
      <GrenadeRenderer grenadesRef={grenadesRef} />

      {/* Shpider Egg Renderer — instanced spheres for in-flight eggs. */}
      <ShpiderEggRenderer eggsRef={eggsRef} />

      {/* Grenade explosion FX — shockwave ring + bright flash. Sits
          on top of the existing flame plumes for the "concussion"
          read. Ref filled imperatively; auto-cleans per effect. */}
      <ExplosionFX ref={explosionFxRef} />

      {/* Vault proximity — emits when player walks into the back-wall
          trigger zone so the HUD prompt + V keybind activate. */}
      {onVaultProximityChange && (
        <VaultProximityWatcher
          cameraRef={cameraRef}
          enabled={true}
          onChange={onVaultProximityChange}
        />
      )}

      {/* Tree-growth proximity — emits true when a growing tree is in
          view range. Parent bumps the growth poller to 1s cadence so
          blocks visibly tick into place instead of jumping in 10s
          batches. */}
      {onGrowthProximityChange && (
        <GrowthProximityWatcher
          cameraRef={cameraRef}
          growingTrees={plantedTrees.filter(t => !t.is_fully_grown)}
          onChange={onGrowthProximityChange}
        />
      )}

      {/* Dropped Loot Items */}
      <DroppedItemRenderer items={droppedItems} userId={currentUserId ?? null} cameraRef={cameraRef} />

      {/* Fruit Renderer - proximity-based fruit spheres with flame plumes */}
      <FruitRenderer
        treeFruits={treeFruits}
        cameraRef={cameraRef}
        playerLevel={playerLevel}
        universalFlameRef={universalFlameRef}
        adminSeeAll={isAdmin && fruitVisibility}
        findClosestFruit={findClosestFruit}
        loadedChunksRef={chunksRef}
      />

      {/* Diamond Renderer - draws 'diamond' fruit_code rows as
          spinning blue gems instead of regular fruits. */}
      <DiamondRenderer
        treeFruits={treeFruits}
        cameraRef={cameraRef}
        renderedChunkKeys={renderedChunkKeys}
        adminSeeAll={isAdmin && fruitVisibility}
      />

      {/* Wide Tree Glow Lights */}
      <WideTreeLights plantedTrees={plantedTrees} />

      {/* Glowing-block point lights — single fixed-count pool */}
      <GlowLightPool />

      {/* Tree Info Labels */}
      <TreeInfoLabels
        trees={plantedTrees}
        seedDefinitions={seedDefinitions}
        usernames={usernamesMap}
        cameraRef={cameraRef}
      />
      
      {/* Pulsing Seed Blocks - DISABLED: causes z-fighting with normal rendering
          Seeds now render through normal PlacedBlocks path with proper raycasting support */}
      {/* <PulsingSeedBlocks
        blocks={allLoadedBlocks}
        seedTexturesByTier={seedTexturesByTier}
      /> */}
      
      <FPSCounter ref={fpsCounterRef} isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />

      {/* Rainbow highlight for Block Inspector selected block */}
      <BlockInspectorHighlight />
    </>
  );
}
