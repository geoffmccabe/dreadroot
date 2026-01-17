import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useRaycaster } from '@/hooks/useRaycaster';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useWispBlock } from '@/hooks/useWispBlock';

import { BillboardWalls } from '@/components/BillboardWalls';
import { PlacedBlocks } from '@/components/PlacedBlocks';
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
import { Waterfall } from './FortressWaterfall';
import { Coins } from './FortressCoins';
import { Bullets, BulletsHandle } from './FortressBullets';
import { SceneProps, WispParticle } from './FortressTypes';
import { createAudioRefs, initializeAudioElements, createThrottledAudioPlayer } from './FortressAudio';
import { getVisibleChunkKeys } from '@/lib/chunkManager';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

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
  performanceMode = false
}: { 
  blocks: PlacedBlock[];
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visibleChunksRef, visualDistance, updatePlayerPosition } = useBlocks();

  const lastChunkRef = useRef({ x: 0, z: 0 });
  const lastUpdateTime = useRef(0);
  const lastVisualDistance = useRef(visualDistance);

  const [renderTrigger, setRenderTrigger] = useState(0);
  const CHUNK_UPDATE_THROTTLE = 100; // ms

  // Initialize visible chunks on mount
  useEffect(() => {
    const visibleChunkKeys = getVisibleChunkKeys(
      camera.position.x,
      camera.position.z,
      visualDistance
    );
    visibleChunksRef.current = new Set(visibleChunkKeys);
    lastChunkRef.current = {
      x: Math.floor(camera.position.x / CHUNK_SIZE),
      z: Math.floor(camera.position.z / CHUNK_SIZE)
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
    for (const chunkKey of visibleChunksRef.current) {
      const chunkBlocks = blocksByChunk.get(chunkKey);
      if (chunkBlocks) filtered.push(...chunkBlocks);
    }
    diagnostics.visibleBlocks = filtered.length;
    return filtered;
  }, [renderTrigger, blocksByChunk, blocks.length, visibleChunksRef]);

  return (
    <PlacedBlocks
      blocks={visibleBlocks}
      showOwnershipOutline={performanceMode ? false : showOwnershipOutline}
      currentUserId={currentUserId}
      hoveredBlockId={performanceMode ? null : (hoveredBlockId || null)}
      onMeshReady={onMeshReady}
      performanceMode={performanceMode}
    />
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
  treeBlocks,
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
  seedDefinitions
}: SceneProps) {
  // Phase 2B: Get updatePlayerPosition from context for chunk loading
  const { updatePlayerPosition } = useBlocks();
  
  // Shared cycle state ref for weather/sky/lighting
  const cycleStateRef = useRef({
    lightingPercentage: weatherSettings.lightingRange[0],
    cyclePosition: 0,
    isNight: false
  });
  
  // Bullet system - use refs to avoid useFrame setState
  // Uses object pool to avoid GC allocations
  const MAX_BULLETS = 20;
  type Bullet = { position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number };
  
  // Pre-allocate bullet pool to avoid per-shot allocations
  const bulletPoolRef = useRef<Bullet[]>(
    Array.from({ length: MAX_BULLETS }, () => ({
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      speed: 100,
      life: 0
    }))
  );
  const activeBulletCount = useRef(0);
  const bulletsRef = useRef<Bullet[]>([]);
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
  
  const { camera, scene } = useThree();
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
  
  const handleMeshReady = useCallback((blockType: string, mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      instancedMeshesRef.current.set(blockType, mesh);
      meshToBlockTypeCache.current.set(mesh, blockType);
      meshesArrayCache.current = Array.from(instancedMeshesRef.current.values());
    } else {
      instancedMeshesRef.current.delete(blockType);
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

  const handleShoot = useCallback(async (origin: THREE.Vector3, direction: THREE.Vector3) => {
    if (await checkWispHit()) return;
    
    // Simple bullet pool: reuse from pool by index, cycling through
    const pool = bulletPoolRef.current;
    const bullet = pool[activeBulletCount.current % MAX_BULLETS];
    activeBulletCount.current++;
    
    // Reset bullet properties
    bullet.position.copy(origin);
    bullet.direction.copy(direction);
    bullet.speed = 100;
    bullet.life = 3.0;
    
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
      let writeIndex = 0;
      
      for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i];
        // Use addScaledVector to avoid allocation
        bullet.position.addScaledVector(bullet.direction, bullet.speed * delta);
        bullet.life -= delta;
        
        if (bullet.life > 0) {
          let hit = false;
          
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
      />
      
      <MultiplayerPlayers players={players} />
      <LocalPlayerAvatar isGunEquipped={crosshairsEnabled} />
      <FirstPersonArms isGunEquipped={crosshairsEnabled} isAiming={isAiming} />
      <SceneReflections />
      
      <DynamicLighting ref={lightingRef} cycleStateRef={cycleStateRef} />
      <DynamicSky ref={skyRef} weatherSettings={weatherSettings} cycleStateRef={cycleStateRef} skyTextureUrl={skyTextureUrl} />

      <FortressStructure fortressTextureUrl={fortressTextureUrl} groundTextureUrl={groundTextureUrl} />
      <BillboardWalls wallPositions={wallPositions} isMoveMode={isMoveMode} />
      <CameraTrackedBlocks 
        blocks={[...blocks, ...treeBlocks]} 
        showOwnershipOutline={showOwnershipOutline && blockPlacementMode} 
        currentUserId={user?.id}
        hoveredBlockId={hoveredBlockId}
        onMeshReady={handleMeshReady}
        performanceMode={performanceMode}
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
      
      {wispState && (
        <WispBlock 
          positionRef={wispPositionRef}
          blockType={wispState.blockType}
          onMeshReady={(mesh) => { wispMeshRef.current = mesh; }}
        />
      )}
      
      <WispParticlesMesh ref={wispParticlesMeshRef} particles={wispParticlesRef.current} renderTrigger={wispRenderTrigger} />
      
      <FPSCounter ref={fpsCounterRef} isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />
    </>
  );
}
