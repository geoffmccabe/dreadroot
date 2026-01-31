import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBulletDefinitions } from '@/contexts/BulletDefinitionsContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useRaycaster } from '@/hooks/useRaycaster';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useWispBlock } from '@/hooks/useWispBlock';

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
// import { FortressParticles } from './FortressParticles'; // Disabled for performance
import { Waterfall } from './FortressWaterfall';
import { Coins } from './FortressCoins';
import { Bullets, BulletsHandle } from './FortressBullets';
import { BulletImpacts, BulletImpactsHandle } from './FortressImpacts';
import { NebulaImpacts, NebulaImpactsHandle } from './FortressNebulaImpacts';
import { Tracers, TracersHandle } from './FortressTracers';
import { SceneProps, WispParticle } from './FortressTypes';
import { createAudioRefs, initializeAudioElements, createThrottledAudioPlayer } from './FortressAudio';
import { getVisibleChunkKeys } from '@/lib/chunkManager';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { worldCollisionGrid, entityCollisionGrid } from '@/lib/spatialHashGrid';

// Shwarm system imports
import { useShwarmSystem, useShwarmMovement, ShwarmRenderer, ShwarmRendererHandle } from '@/features/shwarm';
import { useShnakeSystem, useShnakeMovement, ShnakeRenderer, ShnakeRendererHandle } from '@/features/shnake';
import { useShombieSystem, ShombieRenderer, ShombieRendererHandle, SHOMBIE_HITBOX_RADIUS, SHOMBIE_HITBOX_HEIGHT } from '@/features/shombie';

// Tree system imports
import { TreeInfoLabels } from '@/features/trees/components/TreeInfoLabels';
import { useTreePlanterNames } from '@/features/trees/hooks/useTreePlanterNames';
import { PulsingSeedBlocks } from '@/features/trees/components/PulsingSeedBlocks';

// Universal Enemy AI system (Phase 3)
import { useEnemyAI } from '@/features/enemies/ai';
import { initializeShnakeRevenge, markShnakeIndignant, recordShnakeRevengeDamage } from '@/features/enemies/ai/adapters/ShnakeAdapter';

// Universal spawn command system
import { useSpawnCommands } from '@/features/enemies/hooks/useSpawnCommands';

// Debug flag - disable in production for FPS
const DEBUG_RENDER = false;

// Wisp particles using InstancedMesh for performance (no React re-renders per particle)
const MAX_WISP_PARTICLES = 50;
const wispParticleGeometry = new THREE.SphereGeometry(0.1, 8, 8);
const wispParticleMaterial = new THREE.MeshBasicMaterial({ transparent: true });
const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();

export interface WispParticlesMeshHandle {
  update: () => void;
}

const WispParticlesMesh = React.forwardRef<WispParticlesMeshHandle, { particles: WispParticle[]; renderTrigger: number }>(
  ({ particles, renderTrigger }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    
    // Expose update function instead of using useFrame
    React.useImperativeHandle(ref, () => ({
      update: () => {
        if (!meshRef.current || particles.length === 0) {
          if (meshRef.current) meshRef.current.count = 0;
          return;
        }
        
        let count = 0;
        for (const particle of particles) {
          if (count >= MAX_WISP_PARTICLES) break;
          
          const scale = particle.scale ?? 1.0;
          tempMatrix.makeScale(scale, scale, scale);
          tempMatrix.setPosition(particle.position.x, particle.position.y, particle.position.z);
          meshRef.current.setMatrixAt(count, tempMatrix);
          
          tempColor.set(particle.color);
          meshRef.current.setColorAt(count, tempColor);
          
          count++;
        }
        
        meshRef.current.count = count;
        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
          meshRef.current.instanceColor.needsUpdate = true;
        }
      }
    }), [particles]);
    
    return (
      <instancedMesh
        ref={meshRef}
        args={[wispParticleGeometry, wispParticleMaterial, MAX_WISP_PARTICLES]}
        frustumCulled={false}
      />
    );
  }
);

WispParticlesMesh.displayName = 'WispParticlesMesh';

// Camera-tracked block renderer with chunk culling
function CameraTrackedBlocks({ 
  blocks, 
  showOwnershipOutline, 
  currentUserId, 
  hoveredBlockId, 
  onMeshReady,
  performanceMode = false,
  groundTextureUrl
}: { 
  blocks: PlacedBlock[];
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  groundTextureUrl?: string | null;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visibleChunksRef, visualDistance, updatePlayerPosition } = useBlocks();

  const lastChunkRef = useRef({ x: 0, z: 0 });
  const lastUpdateTime = useRef(0);
  const lastVisualDistance = useRef(visualDistance);

  const [renderTrigger, setRenderTrigger] = useState(0);
  const CHUNK_UPDATE_THROTTLE = 100; // ms

  // Initialize visible chunks on mount
  // CRITICAL: Use the known camera starting position, not camera.position which may be (0,0,0) at mount
  useEffect(() => {
    // Camera starting position - origin
    const CAMERA_START_X = 0;
    const CAMERA_START_Z = 0;
    
    // Use camera position if it's been set, otherwise use starting position
    const initX = camera.position.x !== 0 || camera.position.z !== 0 
      ? camera.position.x 
      : CAMERA_START_X;
    const initZ = camera.position.x !== 0 || camera.position.z !== 0 
      ? camera.position.z 
      : CAMERA_START_Z;
    
    const visibleChunkKeys = getVisibleChunkKeys(initX, initZ, visualDistance);
    visibleChunksRef.current = new Set(visibleChunkKeys);
    lastChunkRef.current = {
      x: Math.floor(initX / CHUNK_SIZE),
      z: Math.floor(initZ / CHUNK_SIZE)
    };
    setRenderTrigger(prev => prev + 1);
  }, [camera, visualDistance, visibleChunksRef]);

  // Recalculate visible chunks when visualDistance changes
  useEffect(() => {
    if (visualDistance !== lastVisualDistance.current) {
      lastVisualDistance.current = visualDistance;
      const visibleChunkKeys = getVisibleChunkKeys(
        camera.position.x,
        camera.position.z,
        visualDistance
      );
      visibleChunksRef.current = new Set(visibleChunkKeys);
      setRenderTrigger(prev => prev + 1);
    }
  }, [visualDistance, camera, visibleChunksRef]);

  // Track camera movement via the centralized frame loop
  useEffect(() => {
    const unregister = frameLoop.register('cameraChunks', () => {
      const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
      const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
      const now = Date.now();

      if ((currentChunkX !== lastChunkRef.current.x || currentChunkZ !== lastChunkRef.current.z) &&
          now - lastUpdateTime.current > CHUNK_UPDATE_THROTTLE) {
        lastUpdateTime.current = now;
        lastChunkRef.current = { x: currentChunkX, z: currentChunkZ };

        const visibleChunkKeys = getVisibleChunkKeys(
          camera.position.x,
          camera.position.z,
          lastVisualDistance.current
        );

        // Reuse set instead of creating a new one
        const setRef = visibleChunksRef.current;
        setRef.clear();
        for (const key of visibleChunkKeys) setRef.add(key);
        diagnostics.e4++;

        // Trigger a React render outside the frame tick
        requestAnimationFrame(() => setRenderTrigger(prev => prev + 1));
      }
    }, 100);

    return unregister;
  }, [camera, visibleChunksRef]);

  // F2.2: Stable ref to avoid unnecessary re-renders when content is unchanged
  const visibleBlocksRef = useRef<PlacedBlock[]>([]);
  const lastVisibleSignatureRef = useRef('');
  
  // Memoize visible blocks based on the stable trigger
  const visibleBlocks = useMemo(() => {
    const filtered: PlacedBlock[] = [];
    const seenIds = new Set<string>();
    
    // Add blocks from visible chunks (includes tree blocks now - unified system)
    for (const chunkKey of visibleChunksRef.current) {
      const chunkBlocks = blocksByChunk.get(chunkKey);
      if (chunkBlocks) {
        for (const block of chunkBlocks) {
          if (!seenIds.has(block.id)) {
            seenIds.add(block.id);
            filtered.push(block);
          }
        }
      }
    }
    
    // F2.2: Cheap signature to detect if content actually changed
    // Only create new array ref if content differs
    const n = filtered.length;
    const sig = n === 0 ? '0' : `${n}|${filtered[0].id}|${filtered[n-1].id}`;
    
    if (sig === lastVisibleSignatureRef.current) {
      // Content unchanged - return stable ref to prevent downstream re-renders
      return visibleBlocksRef.current;
    }
    
    // Content changed - update refs and return new array
    lastVisibleSignatureRef.current = sig;
    visibleBlocksRef.current = filtered;
    return filtered;
  }, [renderTrigger, blocksByChunk, visibleChunksRef]);

  return (
    <>
      <ProceduralGround
        visibleChunksRef={visibleChunksRef}
        renderTrigger={renderTrigger}
        textureUrl={groundTextureUrl || '/grass_texture_seamless.webp'}
      />
      <PlacedBlocks
        blocks={visibleBlocks}
        showOwnershipOutline={performanceMode ? false : showOwnershipOutline}
        currentUserId={currentUserId}
        hoveredBlockId={performanceMode ? null : (hoveredBlockId || null)}
        onMeshReady={onMeshReady}
        performanceMode={performanceMode}
      />
    </>
  );
}

// Calculate which face of the block was hit based on hit position
function calculateHitNormal(
  hitX: number, hitY: number, hitZ: number,
  blockX: number, blockY: number, blockZ: number
): { x: number; y: number; z: number } {
  const EPSILON = 0.001;
  
  // Check each face
  if (Math.abs(hitX - blockX) < EPSILON) return { x: -1, y: 0, z: 0 };
  if (Math.abs(hitX - (blockX + 1)) < EPSILON) return { x: 1, y: 0, z: 0 };
  if (Math.abs(hitY - blockY) < EPSILON) return { x: 0, y: -1, z: 0 };
  if (Math.abs(hitY - (blockY + 1)) < EPSILON) return { x: 0, y: 1, z: 0 };
  if (Math.abs(hitZ - blockZ) < EPSILON) return { x: 0, y: 0, z: -1 };
  if (Math.abs(hitZ - (blockZ + 1)) < EPSILON) return { x: 0, y: 0, z: 1 };
  
  // Fallback: use closest face
  const dx1 = Math.abs(hitX - blockX);
  const dx2 = Math.abs(hitX - (blockX + 1));
  const dy1 = Math.abs(hitY - blockY);
  const dy2 = Math.abs(hitY - (blockY + 1));
  const dz1 = Math.abs(hitZ - blockZ);
  const dz2 = Math.abs(hitZ - (blockZ + 1));
  
  const minD = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
  if (minD === dx1) return { x: -1, y: 0, z: 0 };
  if (minD === dx2) return { x: 1, y: 0, z: 0 };
  if (minD === dy1) return { x: 0, y: -1, z: 0 };
  if (minD === dy2) return { x: 0, y: 1, z: 0 };
  if (minD === dz1) return { x: 0, y: 0, z: -1 };
  return { x: 0, y: 0, z: 1 };
}

export function FortressScene({
  settings, 
  onCoinHit, 
  wallPositions, 
  blockPlacementMode,
  treePlacementMode,
  onBlockPlace,
  onTreePlace,
  onModeChange,
  onOpenPanel,
  crosshairsEnabled,
  getBlockQuantity,
  selectedBlockType,
  selectedSeedTier,
  panelOpen,
  onCycleBlock,
  onCycleSeed,
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
  selectedBulletTier = 1,
  onBulletTierChange,
  playerLevel = 1,
  onPentabulletChargeChange,
  shnakeDefinitions,
  plantedTrees = [],
  shombieDefinitions,
}: SceneProps) {
  // Phase 2B: Get updatePlayerPosition from context for chunk loading
  // IMPORTANT: Use full blocks array from context (all loaded chunks), not just visible blocks prop
  const { updatePlayerPosition, blocks: allLoadedBlocks } = useBlocks();
  const { camera } = useThree();
  
  // Fetch usernames for tree labels
  const { usernamesMap } = useTreePlanterNames(plantedTrees);
  
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
  const cameraRef = useRef<THREE.Camera>(camera);
  cameraRef.current = camera;
  const blocksRef = useRef(allLoadedBlocks);
  blocksRef.current = allLoadedBlocks;
  
  // Callback when entire shwarm group is killed - play yay sound and notify parent
  const handleShwarmGroupKilled = useCallback((tier: number) => {
    if (audioRefs.current.shwarmGroupKilled) {
      audioRefs.current.shwarmGroupKilled.currentTime = 0;
      audioRefs.current.shwarmGroupKilled.play().catch(() => {});
    }
    // Notify parent for kill tracking
    onShwarmGroupKilled?.(tier);
  }, [onShwarmGroupKilled]);
  
  const { shwarms, shwarmsRef, damageBlock, spawnShwarmByTier } = useShwarmSystem({
    definitions: shwarmDefinitions,
    cameraRef,
    blocksRef,
    isEnabled: true,
    onGroupKilled: handleShwarmGroupKilled,
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
  
// Universal Enemy AI system control flag
// Phase G: AI system enabled - controls all enemy behaviors via EnemyManager.
// Legacy movement hooks are disabled when this is true.
const ENABLE_ENEMY_AI = true;

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
    isEnabled: true,
    aiControlled: AI_CONTROLLED,
    onPlayerHit: handleShwarmPlayerHit,
  });
  
  // Shnake system
  const {
    shnakes,
    shnakesRef,
    damageHead: damageShnakeHead,
    spawnOnTree,
    getTreeBlockIndexRefs,
  } = useShnakeSystem({
    definitions: shnakeDefinitions,
    plantedTrees,
    blocksRef,
    isEnabled: true,
  });

  const { treeBlocksByTierRef, nonInvisTreeBlocksByTierRef } = getTreeBlockIndexRefs();
  
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
    spawnShombieGroup,
    spawningEnabled: shombieSpawningEnabled,
    updateMovement: updateShombieMovement,
  } = useShombieSystem({
    definitions: shombieDefinitions,
    cameraRef,
    isEnabled: true,
    userRoles,
    onPlayerHit: handleShombiePlayerHit,
    onShombieKilled,
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
  const handleIndignantRoar = useCallback((shnakeId: string, volume: number) => {
    // Play roar sound at specified volume multiplier (2x for indignant)
    playSpatialSound('/shnake_sound_1.mp3', 10, { baseVolume: 0.5 * volume });
    console.log(`[Shnake] Indignant roar from ${shnakeId} at ${volume}x volume`);
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
    isEnabled: true,
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
    
    // Find nearest tree matching the requested tier (or any tree if none match)
    let nearestTree: typeof plantedTrees[0] | null = null;
    let nearestDist = Infinity;
    
    // First try to find a tree matching the exact tier
    for (const tree of plantedTrees) {
      const treeTier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
      if (treeTier !== tier) continue;
      
      const dx = tree.base_x - camPos.x;
      const dz = tree.base_z - camPos.z;
      const dist = dx * dx + dz * dz;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestTree = tree;
      }
    }
    
    // If no tree of exact tier found, find any nearest tree
    if (!nearestTree) {
      for (const tree of plantedTrees) {
        const dx = tree.base_x - camPos.x;
        const dz = tree.base_z - camPos.z;
        const dist = dx * dx + dz * dz;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTree = tree;
        }
      }
    }
    
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
  }), [spawnShwarmByTier, handleSpawnShnake, spawnShombieGroup]);
  
  useSpawnCommands({
    isEnabled: true,
    isAdmin,
    callbacks: spawnCallbacks,
  });
  
  // Universal Enemy AI system - only enabled when AI_CONTROLLED is true
  // When false, legacy movement hooks handle everything (no double-overhead)
  const { isAIControlled } = useEnemyAI({
    cameraRef,
    shnakesRef,
    shwarmsRef,
    shombiesRef,
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
  const MAX_BULLETS = 20;
  const BULLET_GRAVITY = 9.8; // m/s^2
  type BulletLocal = { 
    position: THREE.Vector3; 
    direction: THREE.Vector3; 
    velocityY: number;
    speed: number; 
    life: number;
    tier: number;
    color: string;
    ricochetScale: number;
    isPentabullet: boolean;
  };
  
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
  const BULLET_RENDER_THROTTLE = 50; // ms
  
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
  
  const { scene } = useThree();
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
  const WISP_RENDER_THROTTLE = 50; // ms
  
  // Refs for consolidated components (avoid separate useFrame hooks)
  const bulletsComponentRef = useRef<BulletsHandle>(null);
  const lightingRef = useRef<LightingHandle>(null);
  const skyRef = useRef<SkyHandle>(null);
  const fpsCounterRef = useRef<FPSCounterHandle>(null);
  const bulletImpactsRef = useRef<BulletImpactsHandle>(null);
  const nebulaImpactsRef = useRef<NebulaImpactsHandle>(null);
  const tracersRef = useRef<TracersHandle>(null);
  
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
      // When removing, we need to find and remove by mesh reference
      for (const [key, storedMesh] of instancedMeshesRef.current.entries()) {
        if (storedMesh === mesh || !mesh) {
          // If mesh is null, we need to find by blockType prefix
          if (!mesh && key.startsWith(blockType + '_')) {
            instancedMeshesRef.current.delete(key);
          } else if (storedMesh === mesh) {
            instancedMeshesRef.current.delete(key);
            break;
          }
        }
      }
      meshesArrayCache.current = Array.from(instancedMeshesRef.current.values());
    }
  }, []);

  // Fog configuration
  const { visualDistance, fogEnabled, currentWorldId } = useBlocks();
  // Scope multiplayer by world - prevents cross-world player visibility
  const { players, broadcastPosition, broadcastPlayerHit, isConnected, localPlayerOnFire, localFireBurnTimeMs, localFireColors, setLocalPlayerOnFire } = useMultiplayer(currentWorldId);
  const { user } = useAuth();
  
  // Refs for player collision detection
  const playersRef = useRef(players);
  playersRef.current = players;
  
  // Removed black background - was causing sky issues

  useEffect(() => {
    if (fogEnabled) {
      const fogStart = (visualDistance * 0.75) * CHUNK_SIZE;
      const fogEnd = visualDistance * CHUNK_SIZE;
      scene.fog = new THREE.Fog(0xcccccc, fogStart, fogEnd);
    } else {
      scene.fog = null;
    }
    return () => {
      scene.fog = null;
    };
  }, [scene, visualDistance, fogEnabled]);

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
    preloadSpatialSounds(['/ricochet_sound.mp3']);

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
        const success = await collectWispBlock(collectedBlock.key);
        
        if (success) {
          const explosionPos = wispPositionRef.current.clone();
          const newParticles: WispParticle[] = [];
          const particleCount = 24;
          
          // Use coin-style explosion algorithm with random 3D directions
          for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const elevation = (Math.random() - 0.3) * Math.PI * 0.8; // More upward bias
            const speed = 4 + Math.random() * 6;
            
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
          
          playAudio(audioRefs.current.wispBoom);
          setTimeout(() => playAudio(audioRefs.current.wispCheer), 200);
          
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
  
  const handleShoot = useCallback(async (origin: THREE.Vector3, direction: THREE.Vector3, isPentabullet: boolean = false) => {
    if (await checkWispHit()) return;
    
    // Simple bullet pool: reuse from pool by index, cycling through
    const pool = bulletPoolRef.current;
    const bullet = pool[activeBulletCount.current % MAX_BULLETS];
    activeBulletCount.current++;
    
    // Get tier definition for velocity and color
    const tierDef = getDefinitionRef.current(selectedBulletTier);
    
    // Normalize direction for consistent speed
    const normalizedDir = direction.clone().normalize();
    
    // Reset bullet properties with physics
    // Bullet starts exactly at camera position
    bullet.position.copy(origin);
    
    // Use velocity from tier definition instead of hardcoded value
    const MUZZLE_VELOCITY = tierDef.velocity;
    
    // Store the FULL normalized direction for movement
    bullet.direction.copy(normalizedDir);
    
    // Speed is the muzzle velocity (horizontal component calculated during movement)
    bullet.speed = MUZZLE_VELOCITY;
    
    // Initial Y velocity = muzzle velocity * vertical component of direction
    // This gets modified by gravity each frame
    bullet.velocityY = normalizedDir.y * MUZZLE_VELOCITY;
    
    bullet.life = 30.0; // Extended lifetime for faster bullets with longer trajectories
    bullet.tier = selectedBulletTier;
    bullet.color = tierDef.colors[0] || '#FFFF00'; // Use first color from tier definition
    bullet.ricochetScale = 1.0; // Full size for first impact
    bullet.isPentabullet = isPentabullet; // Pentabullet shots have 3x larger/longer impacts
    
    // Add immediate muzzle tracer segment (0.5m forward) for real-time feedback
    const muzzleEnd = origin.clone().add(normalizedDir.clone().multiplyScalar(0.5));
    tracersRef.current?.addSegment(
      origin.x, origin.y, origin.z,
      muzzleEnd.x, muzzleEnd.y, muzzleEnd.z,
      bullet.color
    );
    
    // Only add if not already in active list
    if (!bulletsRef.current.includes(bullet)) {
      bulletsRef.current.push(bullet);
    }
    
    setBulletRenderTrigger(prev => prev + 1);
    setShowCrosshairs(true);
  }, [checkWispHit, selectedBulletTier]);

  // Frame loop for bullets and particles - NO setState inside!
  // Uses in-place array filtering (swap-delete) to avoid GC pressure
  useFrame((state, delta) => {
    // D1B: Reset per-frame diagnostic counters ONCE at start of frame
    // This allows InstancedBlockGroup to ACCUMULATE visibleBlocks
    diagnostics.visibleBlocks = 0;
    diagnostics.particleCount = 0;
    diagnostics.coinCount = 0;
    
    // Update diagnostics metrics
    diagnostics.cameraX = camera.position.x;
    diagnostics.cameraY = camera.position.y;
    diagnostics.cameraZ = camera.position.z;
    diagnostics.particleCount = wispParticlesRef.current.length;
    
    // Capture renderer stats for GPU metrics (draw calls, triangles, memory)
    diagnostics.captureRendererStats(state.gl);
    
    // Capture grid stats for collision system monitoring
    diagnostics.captureGridStats(worldCollisionGrid.size, entityCollisionGrid.size);
    
    // Capture per-enemy-type stats for detailed performance tracking
    const activeShwarms = shwarmsRef.current;
    let shwarmBlockCount = 0;
    for (let i = 0; i < activeShwarms.length; i++) {
      const shwarm = activeShwarms[i];
      for (let j = 0; j < shwarm.blocks.length; j++) {
        if (shwarm.blocks[j].isAlive) shwarmBlockCount++;
      }
    }
    diagnostics.captureShwarmStats(activeShwarms.length, shwarmBlockCount);
    
    const activeShnakes = shnakesRef.current;
    let shnakeSegmentCount = 0;
    for (let i = 0; i < activeShnakes.length; i++) {
      shnakeSegmentCount += activeShnakes[i].segments.length;
    }
    diagnostics.captureShnakeStats(activeShnakes.length, shnakeSegmentCount);
    
    diagnostics.captureShombieStats(shombiesRef.current.length);
    
    // Call consolidated component updates (eliminates 5 separate useFrame hooks)
    skyRef.current?.update();
    lightingRef.current?.update();
    bulletsComponentRef.current?.update();
    wispParticlesMeshRef.current?.update();
    fpsCounterRef.current?.update();
    tracersRef.current?.update();
    
    // Tick the centralized frame loop registry (runs all registered callbacks)
    frameLoop.tick(delta, state.clock.elapsedTime);
    
    // Tick the diagnostics system (writes sample every 100ms)
    diagnostics.tick();
    
    const now = Date.now();
    let needsBulletRender = false;
    let needsWispRender = false;
    
    // Update bullets directly in ref - IN-PLACE filtering (no new arrays!)
    const bullets = bulletsRef.current;
    if (bullets.length > 0) {
      const coins = (window as any).getCoins ? (window as any).getCoins() : [];
      const activeShwarms = shwarmsRef.current || [];
      let writeIndex = 0;
      
      for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i];
        
        // Store previous position BEFORE updating (for ray collision)
        const prevX = bullet.position.x;
        const prevY = bullet.position.y;
        const prevZ = bullet.position.z;
        
        // Apply gravity to Y velocity
        bullet.velocityY -= BULLET_GRAVITY * delta;
        
        // Update position using projectile physics:
        // - X and Z move based on the horizontal components of the aim direction
        // - Y uses velocityY which includes gravity
        // direction is the FULL normalized aim direction (x,y,z)
        // speed is the muzzle velocity (100 m/s)
        bullet.position.x += bullet.direction.x * bullet.speed * delta;
        bullet.position.z += bullet.direction.z * bullet.speed * delta;
        bullet.position.y += bullet.velocityY * delta;
        
        // Add tracer segment only if bullet moved at least 2 meters since last segment
        const lastTracerPos = (bullet as any).lastTracerPos;
        if (!lastTracerPos) {
          (bullet as any).lastTracerPos = { x: prevX, y: prevY, z: prevZ };
          tracersRef.current?.addSegment(
            prevX, prevY, prevZ,
            bullet.position.x, bullet.position.y, bullet.position.z,
            bullet.color
          );
        } else {
          const dx = bullet.position.x - lastTracerPos.x;
          const dy = bullet.position.y - lastTracerPos.y;
          const dz = bullet.position.z - lastTracerPos.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          
          if (distSq >= 4.0) { // 2 meters squared
            tracersRef.current?.addSegment(
              lastTracerPos.x, lastTracerPos.y, lastTracerPos.z,
              bullet.position.x, bullet.position.y, bullet.position.z,
              bullet.color
            );
            lastTracerPos.x = bullet.position.x;
            lastTracerPos.y = bullet.position.y;
            lastTracerPos.z = bullet.position.z;
          }
        }
        
        bullet.life -= delta;
        
        // Store previous pos in bullet for collision check later
        (bullet as any).prevX = prevX;
        (bullet as any).prevY = prevY;
        (bullet as any).prevZ = prevZ;
        
        if (bullet.life > 0) {
          let hit = false;
          
          // Check coin collisions
          for (const coin of coins) {
            if (coin.visible) {
              const distance = bullet.position.distanceTo(coin.position);
              if (distance < 0.8) {
                if ((window as any).createCoinExplosion) {
                  (window as any).createCoinExplosion(coin.position.clone(), coin.velocity);
                }
                coin.visible = false;
                if (coin.mesh) coin.mesh.visible = false;
                onCoinHit(coin.position);
                playAudio(audioRefs.current.coinHit);
                hit = true;
                needsBulletRender = true;
                break;
              }
            }
          }
          
          // Check shwarm collisions (if not already hit something)
          if (!hit) {
            // Use ray-AABB intersection to prevent bullets tunneling through targets
            // Check the bullet's travel path this frame, not just its current position
            const SHWARM_HALF_SIZE = 0.35; // Slightly larger for forgiving hit detection
            const BASE_BULLET_DAMAGE = 25;
            // Get the tier's original muzzle velocity for damage scaling
            const tierDef = getDefinitionRef.current(bullet.tier);
            const originalMuzzleVelocity = tierDef.velocity;
            
            // Calculate bullet's actual displacement this frame (not direction-based)
            const moveDistanceXZ = bullet.speed * delta;
            const moveDistanceY = bullet.velocityY * delta + 0.5 * BULLET_GRAVITY * delta * delta; // Include gravity in prev calc
            const prevX = bullet.position.x - bullet.direction.x * moveDistanceXZ;
            const prevY = bullet.position.y - moveDistanceY;
            const prevZ = bullet.position.z - bullet.direction.z * moveDistanceXZ;
            
            // Total displacement vector for ray intersection
            const dispX = bullet.position.x - prevX;
            const dispY = bullet.position.y - prevY;
            const dispZ = bullet.position.z - prevZ;
            const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
            
            // Normalized direction for this frame's movement
            const ndx = dispLen > 0.0001 ? dispX / dispLen : 0;
            const ndy = dispLen > 0.0001 ? dispY / dispLen : 0;
            const ndz = dispLen > 0.0001 ? dispZ / dispLen : 0;
            
            for (const shwarm of activeShwarms) {
              if (!shwarm.isActive || hit) break;
              
              for (const block of shwarm.blocks) {
                if (!block.isAlive) continue;
                
                // AABB bounds centered on block
                const bx = block.position.x;
                const by = block.position.y;
                const bz = block.position.z;
                const minX = bx - SHWARM_HALF_SIZE;
                const maxX = bx + SHWARM_HALF_SIZE;
                const minY = by - SHWARM_HALF_SIZE;
                const maxY = by + SHWARM_HALF_SIZE;
                const minZ = bz - SHWARM_HALF_SIZE;
                const maxZ = bz + SHWARM_HALF_SIZE;
                
                // Ray-AABB intersection (slab method)
                let tMin = 0;
                let tMax = dispLen;
                
                // X slab
                if (Math.abs(ndx) > 0.0001) {
                  const t1 = (minX - prevX) / ndx;
                  const t2 = (maxX - prevX) / ndx;
                  const tNear = Math.min(t1, t2);
                  const tFar = Math.max(t1, t2);
                  tMin = Math.max(tMin, tNear);
                  tMax = Math.min(tMax, tFar);
                } else if (prevX < minX || prevX > maxX) {
                  continue;
                }
                
                // Y slab
                if (Math.abs(ndy) > 0.0001) {
                  const t1 = (minY - prevY) / ndy;
                  const t2 = (maxY - prevY) / ndy;
                  const tNear = Math.min(t1, t2);
                  const tFar = Math.max(t1, t2);
                  tMin = Math.max(tMin, tNear);
                  tMax = Math.min(tMax, tFar);
                } else if (prevY < minY || prevY > maxY) {
                  continue;
                }
                
                // Z slab
                if (Math.abs(ndz) > 0.0001) {
                  const t1 = (minZ - prevZ) / ndz;
                  const t2 = (maxZ - prevZ) / ndz;
                  const tNear = Math.min(t1, t2);
                  const tFar = Math.max(t1, t2);
                  tMin = Math.max(tMin, tNear);
                  tMax = Math.min(tMax, tFar);
                } else if (prevZ < minZ || prevZ > maxZ) {
                  continue;
                }
                
                // If tMin <= tMax, ray intersects the box
                if (tMin <= tMax) {
                  // Hit shwarm block!
                  hit = true;
                  needsBulletRender = true;
                  
                  // Calculate damage based on current velocity vs original muzzle velocity
                  // If bullet has slowed from ricochets, damage is proportionally reduced
                  const velocityRatio = bullet.speed / originalMuzzleVelocity;
                  const scaledDamage = Math.round(BASE_BULLET_DAMAGE * velocityRatio);
                  
                  // Apply damage and get actual damage dealt (capped at remaining health)
                  const { actualDamage } = damageBlock(shwarm.id, block.id, scaledDamage);
                  
                  // Award points based on actual damage dealt
                  if (actualDamage > 0 && onPointsEarned) {
                    onPointsEarned(actualDamage);
                  }
                  
                  // Create particle effect at hit position using the shwarm's texture
                  if (shwarmRendererRef.current) {
                    shwarmRendererRef.current.createHitEffect(
                      block.position.clone(),
                      shwarm.definition.texture_url
                    );
                  }
                  
                  // Play hit sound directly (bypass throttle for combat feedback)
                  const hitSound = audioRefs.current.shwarmHit;
                  if (hitSound) {
                    hitSound.currentTime = 0;
                    hitSound.play().catch(() => {});
                  }
                  
                  break;
                }
              }
            }
          }
          
          // Check SHNAKE collisions (if not already hit something)
          // Head takes damage, body ricochets like building blocks
          if (!hit && shnakeRendererRef.current) {
            const SHNAKE_HALF_SIZE = 0.5;
            const BASE_BULLET_DAMAGE = 25;
            const tierDef = getDefinitionRef.current(bullet.tier);
            const originalMuzzleVelocity = tierDef.velocity;
            
            // Use stored previous position
            const prevX = (bullet as any).prevX ?? bullet.position.x;
            const prevY = (bullet as any).prevY ?? bullet.position.y;
            const prevZ = (bullet as any).prevZ ?? bullet.position.z;
            
            const dispX = bullet.position.x - prevX;
            const dispY = bullet.position.y - prevY;
            const dispZ = bullet.position.z - prevZ;
            const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
            
            if (dispLen > 0.001) {
              const ndx = dispX / dispLen;
              const ndy = dispY / dispLen;
              const ndz = dispZ / dispLen;
              
              // Check all shnakes' segments
              const shnakes = shnakesRef.current || [];
              for (const shnake of shnakes) {
                if (!shnake.isActive || hit) break;
                
                for (let segIdx = 0; segIdx < shnake.segments.length; segIdx++) {
                  const seg = shnake.segments[segIdx];
                  const isHead = segIdx === 0;
                  
                  // AABB for this segment
                  const minX = seg.x;
                  const maxX = seg.x + 1;
                  const minY = seg.y;
                  const maxY = seg.y + 1;
                  const minZ = seg.z;
                  const maxZ = seg.z + 1;
                  
                  // Ray-AABB intersection (slab method)
                  let tMin = 0;
                  let tMax = dispLen;
                  
                  // X slab
                  if (Math.abs(ndx) > 0.0001) {
                    const t1 = (minX - prevX) / ndx;
                    const t2 = (maxX - prevX) / ndx;
                    tMin = Math.max(tMin, Math.min(t1, t2));
                    tMax = Math.min(tMax, Math.max(t1, t2));
                  } else if (prevX < minX || prevX > maxX) continue;
                  
                  // Y slab
                  if (Math.abs(ndy) > 0.0001) {
                    const t1 = (minY - prevY) / ndy;
                    const t2 = (maxY - prevY) / ndy;
                    tMin = Math.max(tMin, Math.min(t1, t2));
                    tMax = Math.min(tMax, Math.max(t1, t2));
                  } else if (prevY < minY || prevY > maxY) continue;
                  
                  // Z slab
                  if (Math.abs(ndz) > 0.0001) {
                    const t1 = (minZ - prevZ) / ndz;
                    const t2 = (maxZ - prevZ) / ndz;
                    tMin = Math.max(tMin, Math.min(t1, t2));
                    tMax = Math.min(tMax, Math.max(t1, t2));
                  } else if (prevZ < minZ || prevZ > maxZ) continue;
                  
                  if (tMin <= tMax) {
                    // HIT a shnake segment!
                    const hitX = prevX + ndx * tMin;
                    const hitY = prevY + ndy * tMin;
                    const hitZ = prevZ + ndz * tMin;
                    const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
                    
                    if (isHead) {
                      // HEAD: takes damage, bullet destroyed
                      hit = true;
                      needsBulletRender = true;
                      
                      const velocityRatio = bullet.speed / originalMuzzleVelocity;
                      const scaledDamage = Math.round(BASE_BULLET_DAMAGE * velocityRatio);
                      
                      const { killedHead, killedEntire, tier: shnakeTier } = damageShnakeHead(shnake.id, scaledDamage);
                      
                      // Initialize revenge tracking - shnake will chase player until it deals this damage back
                      initializeShnakeRevenge(shnake.id, scaledDamage);
                      
                      // Trigger damage flash (3 flashes over 1 second)
                      shnakeRendererRef.current?.triggerDamageFlash(shnake.id);
                      
                      // Award points for damage
                      if (onPointsEarned) {
                        onPointsEarned(scaledDamage);
                      }
                      
                      // Track shnake kill if entire snake died
                      if (killedEntire && onShnakeKilled) {
                        onShnakeKilled(shnakeTier);
                        // Play death sound
                        shnakeRendererRef.current?.playDeathSound(hitPos, shnakeTier);
                      }
                      
                      // Spawn impact effect and add fire to segment
                      // Spawn impact effect - use Nebula for sky-friendly alpha blending
                      const shnakePentaMultiplier = bullet.isPentabullet ? 3.0 : 1.0;
                      const impactConfig = {
                        colors: tierDef.colors,
                        size: tierDef.burn_width * bullet.ricochetScale * shnakePentaMultiplier,
                        height: tierDef.burn_height * bullet.ricochetScale * shnakePentaMultiplier,
                        duration: tierDef.burn_time * shnakePentaMultiplier,
                        tier: bullet.tier,
                      };
                      if (USE_NEBULA_FOR_BULLET_IMPACTS && nebulaImpactsRef.current) {
                        nebulaImpactsRef.current.spawnImpact(hitPos, impactConfig);
                      } else if (bulletImpactsRef.current) {
                        bulletImpactsRef.current.spawnImpact(hitPos, impactConfig);
                      }
                      
                      // Add fire to the new head (segment 0 after damage)
                      shnakeRendererRef.current?.addFireToSegment(
                        shnake.id, 0, tierDef.burn_time * 1000, tierDef.colors
                      );
                      
                      console.log(`[Shnake Hit] Head hit! damage=${scaledDamage} killed=${killedHead} revenge=${scaledDamage}`);
                    } else {
                      // BODY: ricochet like building block
                      if (bullet.ricochetScale > 0.1) {
                        // Play ricochet sound
                        const distToCamera = hitPos.distanceTo(camera.position);
                        playSpatialSound('/ricochet_sound.mp3', distToCamera, { baseVolume: 0.6 });
                        
                        // Calculate hit normal
                        const normal = calculateHitNormal(hitX, hitY, hitZ, seg.x, seg.y, seg.z);
                        
                        // Spawn impact effect
                        // Spawn impact effect - use Nebula for sky-friendly alpha blending
                        const ricochetConfig = {
                          colors: tierDef.colors,
                          size: tierDef.burn_width * bullet.ricochetScale,
                          height: tierDef.burn_height * bullet.ricochetScale,
                          duration: tierDef.burn_time,
                          tier: bullet.tier,
                        };
                        if (USE_NEBULA_FOR_BULLET_IMPACTS && nebulaImpactsRef.current) {
                          nebulaImpactsRef.current.spawnImpact(hitPos, ricochetConfig);
                        } else if (bulletImpactsRef.current) {
                          bulletImpactsRef.current.spawnImpact(hitPos, ricochetConfig);
                        }
                        
                        // Add fire to this segment (propagates as shnake moves)
                        shnakeRendererRef.current?.addFireToSegment(
                          shnake.id, segIdx, tierDef.burn_time * 1000, tierDef.colors
                        );
                        
                        // Apply reflection physics: R = D - 2(D·N)N
                        const dot = ndx * normal.x + ndy * normal.y + ndz * normal.z;
                        bullet.direction.set(
                          ndx - 2 * dot * normal.x,
                          0,
                          ndz - 2 * dot * normal.z
                        ).normalize();
                        
                        bullet.velocityY = bullet.velocityY - 2 * dot * normal.y * bullet.speed;
                        bullet.speed *= 0.75;
                        bullet.velocityY *= 0.75;
                        bullet.ricochetScale *= 0.5;
                        
                        bullet.position.set(
                          hitX + normal.x * 0.05,
                          hitY + normal.y * 0.05,
                          hitZ + normal.z * 0.05
                        );
                        
                        needsBulletRender = true;
                        // Mark shnake as indignant - will trigger wiggle animation and 2x volume roar
                        markShnakeIndignant(shnake.id);
                        console.log(`[Shnake Hit] Body ricochet at segment ${segIdx} - shnake indignant!`);
                      } else {
                        // Too weak to ricochet, just destroy bullet
                        hit = true;
                        needsBulletRender = true;
                      }
                    }
                    break;
                  }
                }
              }
            }
          }
          
          // Check SHOMBIE collisions (if not already hit something)
          // Ray-Cylinder intersection for accurate hit detection (prevents tunneling)
          if (!hit && shombieRendererRef.current) {
            const BASE_BULLET_DAMAGE = 25;
            const tierDef = getDefinitionRef.current(bullet.tier);
            const originalMuzzleVelocity = tierDef.velocity;
            
            // Use stored previous position for ray intersection
            const prevX = (bullet as any).prevX ?? bullet.position.x;
            const prevY = (bullet as any).prevY ?? bullet.position.y;
            const prevZ = (bullet as any).prevZ ?? bullet.position.z;
            
            // Ray direction and length
            const rayDirX = bullet.position.x - prevX;
            const rayDirY = bullet.position.y - prevY;
            const rayDirZ = bullet.position.z - prevZ;
            const rayLen = Math.sqrt(rayDirX * rayDirX + rayDirY * rayDirY + rayDirZ * rayDirZ);
            
            if (rayLen > 0.001) {
              // Normalized ray direction
              const ndx = rayDirX / rayLen;
              const ndy = rayDirY / rayLen;
              const ndz = rayDirZ / rayLen;
              
              // Check all shombies
              const shombieList = shombiesRef.current || [];
              for (const shombie of shombieList) {
                if (!shombie.isActive || hit) break;
                
                // Calculate hitbox directly from shombie object (avoids stale React state in getHitbox)
                const scale = shombie.scale || 1;
                const hitboxRadius = SHOMBIE_HITBOX_RADIUS * scale;
                const hitboxHeight = SHOMBIE_HITBOX_HEIGHT * scale;
                
                // Ray-Cylinder intersection
                // Project ray onto XZ plane for infinite cylinder test
                const ocX = prevX - shombie.position.x;
                const ocZ = prevZ - shombie.position.z;
                
                // Quadratic coefficients for 2D circle intersection in XZ plane
                const a = ndx * ndx + ndz * ndz;
                const b = 2 * (ocX * ndx + ocZ * ndz);
                const c = ocX * ocX + ocZ * ocZ - hitboxRadius * hitboxRadius;
                
                const discriminant = b * b - 4 * a * c;
                
                if (discriminant >= 0 && a > 0.0001) {
                  const sqrtD = Math.sqrt(discriminant);
                  const t1 = (-b - sqrtD) / (2 * a);
                  const t2 = (-b + sqrtD) / (2 * a);
                  
                  // Check if either intersection is within ray length
                  let hitT = -1;
                  if (t1 >= 0 && t1 <= rayLen) hitT = t1;
                  else if (t2 >= 0 && t2 <= rayLen) hitT = t2;
                  
                  if (hitT >= 0) {
                    // Check Y bounds at hit point
                    const hitY = prevY + ndy * hitT;
                    const shombieMinY = shombie.position.y;
                    const shombieMaxY = shombie.position.y + hitboxHeight;
                    
                    if (hitY >= shombieMinY && hitY <= shombieMaxY) {
                      // HIT a shombie!
                      hit = true;
                      needsBulletRender = true;
                      
                      // Calculate hit position for effects
                      const hitPosX = prevX + ndx * hitT;
                      const hitPosZ = prevZ + ndz * hitT;
                      
                      const velocityRatio = bullet.speed / originalMuzzleVelocity;
                      const scaledDamage = Math.round(BASE_BULLET_DAMAGE * velocityRatio);
                      
                      // Headshot bonus (upper 25% of body)
                      const headThreshold = shombieMinY + hitboxHeight * 0.75;
                      const isHeadshot = hitY > headThreshold;
                      const finalDamage = isHeadshot ? scaledDamage * 2 : scaledDamage;
                      
                      // Calculate knockback direction (horizontal only) - from hit toward shombie center
                      const kbDx = shombie.position.x - hitPosX;
                      const kbDz = shombie.position.z - hitPosZ;
                      const knockbackDir = new THREE.Vector3(kbDx, 0, kbDz).normalize();
                      
                      // Bullet travel direction for headshot knockdown
                      const bulletDir = new THREE.Vector3(ndx, 0, ndz).normalize();
                      
                      // Apply damage with headshot flag and bullet direction
                      const killed = damageShombie(shombie.id, finalDamage, knockbackDir, isHeadshot, bulletDir);
                      
                      // Award points
                      if (onPointsEarned) {
                        onPointsEarned(finalDamage);
                      }
                      
                      // Determine which body part was hit and attach fire to it
                      // Body part mapping based on hit height relative to shombie base
                      const relativeHitHeight = hitY - shombie.position.y;
                      const scale = shombie.scale || 1;
                      
                      // Map hit height to body part (scaled heights from types.ts)
                      let hitPartName = 'torso'; // default
                      if (relativeHitHeight > 1.5 * scale) {
                        hitPartName = 'head';
                      } else if (relativeHitHeight > 1.0 * scale) {
                        // Upper body - could be torso or arms
                        if (Math.abs(hitPosX - shombie.position.x) > 0.3 * scale) {
                          hitPartName = hitPosX > shombie.position.x ? 'rightUpperArm' : 'leftUpperArm';
                        } else {
                          hitPartName = 'torso';
                        }
                      } else if (relativeHitHeight > 0.5 * scale) {
                        // Mid body - torso or lower arms
                        if (Math.abs(hitPosX - shombie.position.x) > 0.3 * scale) {
                          hitPartName = hitPosX > shombie.position.x ? 'rightLowerArm' : 'leftLowerArm';
                        } else {
                          hitPartName = 'torso';
                        }
                      } else if (relativeHitHeight > 0.3 * scale) {
                        // Upper legs
                        hitPartName = hitPosX > shombie.position.x ? 'rightUpperLeg' : 'leftUpperLeg';
                      } else {
                        // Lower legs
                        hitPartName = hitPosX > shombie.position.x ? 'rightLowerLeg' : 'leftLowerLeg';
                      }
                      
                      // Attach fire to the body part that moves with the shombie
                      if (shombieRendererRef.current) {
                        const pentaMultiplier = bullet.isPentabullet ? 3.0 : 1.0;
                        const fireDuration = tierDef.burn_time * pentaMultiplier * 1000; // Convert to ms
                        shombieRendererRef.current.addFireToBodyPart(
                          shombie.id,
                          hitPartName,
                          fireDuration,
                          tierDef.colors
                        );
                      }
                      
                      if (isHeadshot) {
                        console.log(`[Shombie Hit] HEADSHOT! damage=${finalDamage} killed=${killed}`);
                      } else {
                        console.log(`[Shombie Hit] Body hit, damage=${finalDamage} killed=${killed}`);
                      }
                      
                      break;
                    }
                  }
                }
              }
            }
          }
          
          // Check block collisions (if not already hit something)
          if (!hit) {
            // Use stored previous position for accurate ray collision
            const prevX = (bullet as any).prevX ?? bullet.position.x;
            const prevY = (bullet as any).prevY ?? bullet.position.y;
            const prevZ = (bullet as any).prevZ ?? bullet.position.z;
            
            const dispX = bullet.position.x - prevX;
            const dispY = bullet.position.y - prevY;
            const dispZ = bullet.position.z - prevZ;
            const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
            
            // Skip collision if bullet barely moved
            if (dispLen < 0.001) continue;
            
            const ndx = dispX / dispLen;
            const ndy = dispY / dispLen;
            const ndz = dispZ / dispLen;
            
            // Only check blocks within reasonable distance of bullet path
            const checkRadius = dispLen + 2;
            
            for (const block of blocks) {
              // Quick bounding sphere check first
              const centerX = block.position_x + 0.5;
              const centerY = block.position_y + 0.5;
              const centerZ = block.position_z + 0.5;
              
              const toBulletX = bullet.position.x - centerX;
              const toBulletY = bullet.position.y - centerY;
              const toBulletZ = bullet.position.z - centerZ;
              const distSq = toBulletX * toBulletX + toBulletY * toBulletY + toBulletZ * toBulletZ;
              
              if (distSq > checkRadius * checkRadius) continue;
              
              // Ray-AABB intersection (block goes from position to position+1)
              const minX = block.position_x;
              const maxX = block.position_x + 1;
              const minY = block.position_y;
              const maxY = block.position_y + 1;
              const minZ = block.position_z;
              const maxZ = block.position_z + 1;
              
              let tMin = 0;
              let tMax = dispLen;
              
              // X slab
              if (Math.abs(ndx) > 0.0001) {
                const t1 = (minX - prevX) / ndx;
                const t2 = (maxX - prevX) / ndx;
                tMin = Math.max(tMin, Math.min(t1, t2));
                tMax = Math.min(tMax, Math.max(t1, t2));
              } else if (prevX < minX || prevX > maxX) continue;
              
              // Y slab
              if (Math.abs(ndy) > 0.0001) {
                const t1 = (minY - prevY) / ndy;
                const t2 = (maxY - prevY) / ndy;
                tMin = Math.max(tMin, Math.min(t1, t2));
                tMax = Math.min(tMax, Math.max(t1, t2));
              } else if (prevY < minY || prevY > maxY) continue;
              
              // Z slab
              if (Math.abs(ndz) > 0.0001) {
                const t1 = (minZ - prevZ) / ndz;
                const t2 = (maxZ - prevZ) / ndz;
                tMin = Math.max(tMin, Math.min(t1, t2));
                tMax = Math.min(tMax, Math.max(t1, t2));
              } else if (prevZ < minZ || prevZ > maxZ) continue;
              
              // If tMin <= tMax, ray intersects the block
              if (tMin <= tMax) {
                // Calculate hit position
                const hitX = prevX + ndx * tMin;
                const hitY = prevY + ndy * tMin;
                const hitZ = prevZ + ndz * tMin;
                
                // Check if this block is a "building" category for ricochet
                const blockDef = blocksMapRef.current?.get(block.block_type);
                const isBuilding = blockDef?.category === 'building';
                
                // Ricochet off building blocks if scale is still meaningful
                if (isBuilding && bullet.ricochetScale > 0.1) {
                  // Calculate distance from camera for spatial audio
                  const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
                  const distToCamera = hitPos.distanceTo(camera.position);
                  
                  // Play ricochet sound with distance-based falloff
                  playSpatialSound('/ricochet_sound.mp3', distToCamera, {
                    baseVolume: 0.6,
                  });
                  
                  // Calculate which face was hit for reflection normal
                  const normal = calculateHitNormal(
                    hitX, hitY, hitZ,
                    block.position_x, block.position_y, block.position_z
                  );
                  
                  // Spawn scaled impact effect
                  // Spawn scaled impact effect - use Nebula for sky-friendly alpha blending
                  const ricochetHitPos = new THREE.Vector3(hitX, hitY, hitZ);
                  const tierDefRicochet = getDefinitionRef.current(bullet.tier);
                  const pentaMultiplierRicochet = bullet.isPentabullet ? 3.0 : 1.0;
                  const ricochetBlockConfig = {
                    colors: tierDefRicochet.colors,
                    size: tierDefRicochet.burn_width * bullet.ricochetScale * pentaMultiplierRicochet,
                    height: tierDefRicochet.burn_height * bullet.ricochetScale * pentaMultiplierRicochet,
                    duration: tierDefRicochet.burn_time * pentaMultiplierRicochet,
                    tier: bullet.tier,
                  };
                  if (USE_NEBULA_FOR_BULLET_IMPACTS && nebulaImpactsRef.current) {
                    nebulaImpactsRef.current.spawnImpact(ricochetHitPos, ricochetBlockConfig);
                  } else if (bulletImpactsRef.current) {
                    bulletImpactsRef.current.spawnImpact(ricochetHitPos, ricochetBlockConfig);
                  }
                  
                  // Apply reflection physics: R = D - 2(D·N)N
                  const dot = ndx * normal.x + ndy * normal.y + ndz * normal.z;
                  bullet.direction.set(
                    ndx - 2 * dot * normal.x,
                    0, // Y handled via velocityY
                    ndz - 2 * dot * normal.z
                  ).normalize();
                  
                  // Reflect Y velocity component
                  bullet.velocityY = bullet.velocityY - 2 * dot * normal.y * bullet.speed;
                  
                  // Reduce velocity by 25%
                  bullet.speed *= 0.75;
                  bullet.velocityY *= 0.75;
                  
                  // Reduce impact scale by 50% for next ricochet
                  bullet.ricochetScale *= 0.5;
                  
                  // Reposition bullet slightly outside block to prevent re-collision
                  bullet.position.set(
                    hitX + normal.x * 0.05,
                    hitY + normal.y * 0.05,
                    hitZ + normal.z * 0.05
                  );
                  
                  needsBulletRender = true;
                  // Don't remove bullet - continue to next frame
                } else {
                  // Non-building block or too weak: destroy bullet with impact
                  hit = true;
                  needsBulletRender = true;
                  
                  // Spawn impact effect at hit position with bullet tier settings from context
                  // Spawn impact effect at hit position - use Nebula for sky-friendly alpha blending
                  const destroyHitPos = new THREE.Vector3(hitX, hitY, hitZ);
                  const tierDefDestroy = getDefinitionRef.current(bullet.tier);
                  const destroyBlockConfig = {
                    colors: tierDefDestroy.colors,
                    size: tierDefDestroy.burn_width * bullet.ricochetScale,
                    height: tierDefDestroy.burn_height * bullet.ricochetScale,
                    duration: tierDefDestroy.burn_time,
                    tier: bullet.tier,
                  };
                  if (USE_NEBULA_FOR_BULLET_IMPACTS && nebulaImpactsRef.current) {
                    nebulaImpactsRef.current.spawnImpact(destroyHitPos, destroyBlockConfig);
                  } else if (bulletImpactsRef.current) {
                    bulletImpactsRef.current.spawnImpact(destroyHitPos, destroyBlockConfig);
                  }
                }
                break;
              }
            }
            
            // Also check ground collision (y <= 0)
            if (!hit && bullet.position.y <= 0) {
              hit = true;
              needsBulletRender = true;
              
              // Spawn impact effect at ground level with bullet tier settings from context
              // Spawn impact effect at ground level - use Nebula for sky-friendly alpha blending
              const groundPos = bullet.position.clone();
              groundPos.y = 0.1; // Slightly above ground
              const tierDefGround = getDefinitionRef.current(bullet.tier);
              const pentaMultiplierGround = bullet.isPentabullet ? 3.0 : 1.0;
              const groundConfig = {
                colors: tierDefGround.colors,
                size: tierDefGround.burn_width * pentaMultiplierGround,
                height: tierDefGround.burn_height * pentaMultiplierGround,
                duration: tierDefGround.burn_time * pentaMultiplierGround,
                tier: bullet.tier,
              };
              if (USE_NEBULA_FOR_BULLET_IMPACTS && nebulaImpactsRef.current) {
                nebulaImpactsRef.current.spawnImpact(groundPos, groundConfig);
              } else if (bulletImpactsRef.current) {
                bulletImpactsRef.current.spawnImpact(groundPos, groundConfig);
              }
            }
          }
          
          if (!hit) {
            // In-place keep: write to writeIndex position
            bullets[writeIndex] = bullet;
            writeIndex++;
          }
        } else {
          needsBulletRender = true;
        }
      }
      
      // Truncate array in-place (no new array allocation)
      bullets.length = writeIndex;
    }
    
    // Update wisp particles directly in ref - IN-PLACE filtering
    const particles = wispParticlesRef.current;
    if (particles.length > 0) {
      let writeIndex = 0;
      
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        // Use addScaledVector to avoid clone() allocation
        particle.position.addScaledVector(particle.velocity, delta);
        particle.velocity.y -= 9.8 * delta;
        particle.life -= delta;
        
        if (particle.life > 0 && particle.position.y > 0) {
          // In-place keep
          particles[writeIndex] = particle;
          writeIndex++;
        } else {
          needsWispRender = true;
        }
      }
      
      // Truncate array in-place
      particles.length = writeIndex;
    }
    
    // Throttled render triggers - only when something changed
    if (needsBulletRender && now - lastBulletRender.current > BULLET_RENDER_THROTTLE) {
      lastBulletRender.current = now;
      setBulletRenderTrigger(prev => prev + 1);
    }
    
    if (needsWispRender && now - lastWispRender.current > WISP_RENDER_THROTTLE) {
      lastWispRender.current = now;
      setWispRenderTrigger(prev => prev + 1);
    }
    
    // Update shwarm renderer (always, since movement is continuous)
    shwarmRendererRef.current?.update();
    
    // Update shombie movement (pathfinding to player) - skip if AI controls
    if (!isAIControlled) {
      updateShombieMovement(delta);
    }
    
    // Update shombie renderer
    shombieRendererRef.current?.update(camera.position, delta);
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
        onBlockPlace={onBlockPlace}
        onTreePlace={onTreePlace}
        onOpenPanel={onOpenPanel}
        onModeChange={onModeChange}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        selectedSeedTier={selectedSeedTier}
        panelOpen={panelOpen}
        onCycleBlock={onCycleBlock}
        onCycleSeed={onCycleSeed}
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
        onBulletTierChange={onBulletTierChange}
        playerLevel={playerLevel}
        onPentabulletChargeChange={onPentabulletChargeChange}
        onSpawnShnake={handleSpawnShnake}
      />
      
      <MultiplayerPlayers players={players} />
      <LocalPlayerAvatar isGunEquipped={crosshairsEnabled} />
      <FirstPersonArms isGunEquipped={crosshairsEnabled} isAiming={isAiming} />
      <SceneReflections />
      
      <DynamicLighting ref={lightingRef} cycleStateRef={cycleStateRef} />
      <DynamicSky ref={skyRef} weatherSettings={weatherSettings} cycleStateRef={cycleStateRef} skyTextureUrl={skyTextureUrl} />

      <FortressStructure fortressTextureUrl={fortressTextureUrl} groundTextureUrl={groundTextureUrl} />
      {/* <FortressParticles /> */}
      <BillboardWalls wallPositions={wallPositions} isMoveMode={isMoveMode} />
      <CameraTrackedBlocks 
        blocks={blocks} 
        showOwnershipOutline={showOwnershipOutline && blockPlacementMode} 
        currentUserId={user?.id}
        hoveredBlockId={hoveredBlockId}
        onMeshReady={handleMeshReady}
        performanceMode={performanceMode}
        groundTextureUrl={groundTextureUrl}
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
      
      {wispState && (
        <WispBlock 
          positionRef={wispPositionRef}
          blockType={wispState.blockType}
          onMeshReady={(mesh) => { wispMeshRef.current = mesh; }}
        />
      )}
      
      <WispParticlesMesh ref={wispParticlesMeshRef} particles={wispParticlesRef.current} renderTrigger={wispRenderTrigger} />
      
      {/* Shwarm Renderer */}
      <ShwarmRenderer ref={shwarmRendererRef} shwarms={shwarms} />

      {/* Shnake Renderer */}
      <ShnakeRenderer ref={shnakeRendererRef} shnakesRef={shnakesRef} cameraRef={cameraRef} />
      
      {/* Shombie Renderer */}
      <ShombieRenderer ref={shombieRendererRef} shombies={shombies} />
      
      {/* Tree Info Labels */}
      <TreeInfoLabels 
        trees={plantedTrees} 
        seedDefinitions={seedDefinitions} 
        usernames={usernamesMap} 
      />
      
      {/* Pulsing Seed Blocks - renders fruit blocks with animated glow */}
      <PulsingSeedBlocks 
        blocks={allLoadedBlocks} 
        seedTexturesByTier={seedTexturesByTier} 
      />
      
      <FPSCounter ref={fpsCounterRef} isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />
    </>
  );
}
