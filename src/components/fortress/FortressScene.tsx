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
import { SceneProps, WispParticle } from './FortressTypes';
import { createAudioRefs, initializeAudioElements, createThrottledAudioPlayer } from './FortressAudio';
import { getVisibleChunkKeys } from '@/lib/chunkManager';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

// Shwarm system imports
import { useShwarmSystem, useShwarmMovement, ShwarmRenderer, ShwarmRendererHandle } from '@/features/shwarm';

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
    // Camera starting position from FortressControls: [-8, 1.8, 22]
    const CAMERA_START_X = -8;
    const CAMERA_START_Z = 22;
    
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
    
    diagnostics.visibleBlocks = filtered.length;
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
  seedDefinitions,
  healthRef,
  takeDamage,
  shwarmDefinitions,
  onShwarmDamage,
  onPointsEarned,
  onShwarmGroupKilled,
  respawnPosition,
  onRespawnComplete,
  isOwnedTreeAtPosition,
  onTreeChopComplete,
  onTreeChopProgress
}: SceneProps) {
  // Phase 2B: Get updatePlayerPosition from context for chunk loading
  const { updatePlayerPosition } = useBlocks();
  const { camera } = useThree();
  
  // Shwarm system
  const cameraRef = useRef<THREE.Camera>(camera);
  cameraRef.current = camera;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  
  // Callback when entire shwarm group is killed - play yay sound and notify parent
  const handleShwarmGroupKilled = useCallback((tier: number) => {
    if (audioRefs.current.shwarmGroupKilled) {
      audioRefs.current.shwarmGroupKilled.currentTime = 0;
      audioRefs.current.shwarmGroupKilled.play().catch(() => {});
    }
    // Notify parent for kill tracking
    onShwarmGroupKilled?.(tier);
  }, [onShwarmGroupKilled]);
  
  const { shwarms, shwarmsRef, damageBlock } = useShwarmSystem({
    definitions: shwarmDefinitions,
    cameraRef,
    blocksRef,
    isEnabled: true,
    onGroupKilled: handleShwarmGroupKilled,
  });
  
  // Player hit callback for shwarm collisions - use ref to avoid stale closure
  const handleShwarmPlayerHitRef = useRef<(damage: number, knockbackForce: number, direction: THREE.Vector3) => void>();
  
  // Update the ref after playAudio is defined
  useEffect(() => {
    handleShwarmPlayerHitRef.current = (damage: number, knockbackForce: number, direction: THREE.Vector3) => {
      // Apply damage
      if (takeDamage) {
        takeDamage(damage, direction, knockbackForce);
      }
      
      // Play player hit sound
      if (audioRefs.current.playerHit) {
        audioRefs.current.playerHit.currentTime = 0;
        audioRefs.current.playerHit.play().catch(() => {});
      }
    };
  }, [takeDamage]);
  
  // Wrapper callback that delegates to ref
  const handleShwarmPlayerHit = useCallback((damage: number, knockbackForce: number, direction: THREE.Vector3) => {
    handleShwarmPlayerHitRef.current?.(damage, knockbackForce, direction);
  }, []);
  
  useShwarmMovement({
    shwarmsRef,
    cameraRef,
    isEnabled: true,
    onPlayerHit: handleShwarmPlayerHit,
  });
  
  const shwarmRendererRef = useRef<ShwarmRendererHandle>(null);
  
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
      color: '#FFFF00'
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
  const { blocks: allBlocks } = useBlocksData();
  const basicBlocks = useMemo(() => 
    allBlocks.filter(block => block.class === 'basic'),
    [allBlocks]
  );
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
  const { players, broadcastPosition, isConnected } = useMultiplayer(currentWorldId);
  const { user } = useAuth();
  
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
          for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20;
            const speed = 3 + Math.random() * 2;
            newParticles.push({
              position: explosionPos.clone(),
              velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.random() * 2 + 1, Math.sin(angle) * speed),
              life: 1,
              color: '#' + Math.floor(Math.random() * 16777215).toString(16)
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
  
  const handleShoot = useCallback(async (origin: THREE.Vector3, direction: THREE.Vector3) => {
    if (await checkWispHit()) return;
    
    // Simple bullet pool: reuse from pool by index, cycling through
    const pool = bulletPoolRef.current;
    const bullet = pool[activeBulletCount.current % MAX_BULLETS];
    activeBulletCount.current++;
    
    // Normalize direction for consistent speed
    const normalizedDir = direction.clone().normalize();
    
    // Reset bullet properties with physics
    // Bullet starts exactly at camera position
    bullet.position.copy(origin);
    
    // CRITICAL FIX FOR BELOW-HORIZON AIMING:
    // The horizontal direction must be normalized separately to maintain constant horizontal speed
    // Otherwise, aiming down reduces horizontal speed (making bullets land short)
    const horizontalLen = Math.sqrt(normalizedDir.x * normalizedDir.x + normalizedDir.z * normalizedDir.z);
    
    // Store normalized HORIZONTAL direction (X and Z only, normalized to length 1)
    if (horizontalLen > 0.0001) {
      bullet.direction.set(
        normalizedDir.x / horizontalLen,  // Normalize X to horizontal plane
        0,                                  // Y is handled by velocityY
        normalizedDir.z / horizontalLen   // Normalize Z to horizontal plane
      );
    } else {
      // Shooting straight up/down - no horizontal movement
      bullet.direction.set(0, 0, 0);
    }
    
    // Horizontal speed is constant (100 units/sec) scaled by how horizontal the aim is
    // When aiming at 45° down, horizontalLen ≈ 0.707, so horizontal speed = 70.7
    // This is physically correct - the bullet's total velocity is still 100, just angled
    const BULLET_SPEED = 100;
    bullet.speed = BULLET_SPEED * horizontalLen;  // Horizontal component of total speed
    
    // Initial Y velocity = speed * vertical component of direction
    // This gets modified by gravity each frame
    bullet.velocityY = normalizedDir.y * BULLET_SPEED;
    
    bullet.life = 5.0;
    bullet.tier = 1;
    bullet.color = '#FFFF00';
    
    // Only add if not already in active list
    if (!bulletsRef.current.includes(bullet)) {
      bulletsRef.current.push(bullet);
    }
    
    setBulletRenderTrigger(prev => prev + 1);
    setShowCrosshairs(true);
  }, [checkWispHit]);

  // Frame loop for bullets and particles - NO setState inside!
  // Uses in-place array filtering (swap-delete) to avoid GC pressure
  useFrame((state, delta) => {
    // Master frame loop - tick() increments masterFrameCount
    
    // Update diagnostics metrics
    diagnostics.cameraX = camera.position.x;
    diagnostics.cameraY = camera.position.y;
    diagnostics.cameraZ = camera.position.z;
    diagnostics.particleCount = wispParticlesRef.current.length;
    
    // Call consolidated component updates (eliminates 5 separate useFrame hooks)
    skyRef.current?.update();
    lightingRef.current?.update();
    bulletsComponentRef.current?.update();
    wispParticlesMeshRef.current?.update();
    fpsCounterRef.current?.update();
    
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
        
        // Update position:
        // - direction is the HORIZONTAL direction (normalized X/Z only)
        // - speed is the HORIZONTAL speed component
        // - velocityY handles vertical movement with gravity
        bullet.position.x += bullet.direction.x * bullet.speed * delta;
        bullet.position.z += bullet.direction.z * bullet.speed * delta;
        bullet.position.y += bullet.velocityY * delta;
        
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
            const BULLET_DAMAGE = 25;
            
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
                  
                  // Apply damage and get actual damage dealt (capped at remaining health)
                  const { actualDamage } = damageBlock(shwarm.id, block.id, BULLET_DAMAGE);
                  
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
                hit = true;
                needsBulletRender = true;
                
                // Calculate hit position
                const hitX = prevX + ndx * tMin;
                const hitY = prevY + ndy * tMin;
                const hitZ = prevZ + ndz * tMin;
                
                // Spawn impact effect at hit position with bullet tier settings from context
                if (bulletImpactsRef.current) {
                  const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
                  const tierDef = getDefinitionRef.current(bullet.tier);
                  bulletImpactsRef.current.spawnImpact(hitPos, {
                    colors: tierDef.colors,
                    size: tierDef.burn_width,
                    height: tierDef.burn_height,
                    duration: tierDef.burn_time,
                    tier: bullet.tier,
                  });
                }
                break;
              }
            }
            
            // Also check ground collision (y <= 0)
            if (!hit && bullet.position.y <= 0) {
              hit = true;
              needsBulletRender = true;
              
              // Spawn impact effect at ground level with bullet tier settings from context
              if (bulletImpactsRef.current) {
                const groundPos = bullet.position.clone();
                groundPos.y = 0.1; // Slightly above ground
                const tierDef = getDefinitionRef.current(bullet.tier);
                bulletImpactsRef.current.spawnImpact(groundPos, {
                  colors: tierDef.colors,
                  size: tierDef.burn_width,
                  height: tierDef.burn_height,
                  duration: tierDef.burn_time,
                  tier: bullet.tier,
                });
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
        applyKnockback={undefined}
        respawnPosition={respawnPosition}
        onRespawnComplete={onRespawnComplete}
        isOwnedTreeAtPosition={isOwnedTreeAtPosition}
        onTreeChopComplete={onTreeChopComplete}
        onTreeChopProgress={onTreeChopProgress}
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
      
      <FPSCounter ref={fpsCounterRef} isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />
    </>
  );
}
