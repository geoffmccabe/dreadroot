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
import { FPSCounter } from '@/components/FPSCounter';
import { WispBlock } from '@/components/WispBlock';

import { FirstPersonControls } from './FortressControls';
import { DynamicSky } from './FortressSky';
import { DynamicLighting } from './FortressLighting';
import { FortressStructure } from './FortressStructure';
import { Waterfall } from './FortressWaterfall';
import { Coins } from './FortressCoins';
import { Bullets } from './FortressBullets';
import { SceneProps, WispParticle } from './FortressTypes';
import { createAudioRefs, initializeAudioElements, createThrottledAudioPlayer } from './FortressAudio';
import { getVisibleChunkKeys } from '@/lib/chunkManager';

// Camera-tracked block renderer with chunk culling
function CameraTrackedBlocks({ 
  blocks, 
  showOwnershipOutline, 
  currentUserId, 
  hoveredBlockId, 
  onMeshReady 
}: { 
  blocks: PlacedBlock[];
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visualDistance } = useBlocks();
  
  // Use refs to avoid state updates inside useFrame
  const visibleChunksRef = useRef<Set<string>>(new Set());
  const lastChunkRef = useRef({ x: 0, z: 0 });
  const lastUpdateTime = useRef(0);
  const lastVisualDistance = useRef(visualDistance);
  
  // Trigger for re-renders - only updated via throttled mechanism
  const [renderTrigger, setRenderTrigger] = useState(0);
  
  const CHUNK_UPDATE_THROTTLE = 100; // ms
  
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
  }, [visualDistance, camera]);
  
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
  }, []);
  
  // Track camera movement - no state updates inside useFrame
  useFrame(() => {
    const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
    const now = Date.now();
    
    // Only update when camera crosses chunk boundary AND throttle time has passed
    if ((currentChunkX !== lastChunkRef.current.x || 
         currentChunkZ !== lastChunkRef.current.z) &&
        now - lastUpdateTime.current > CHUNK_UPDATE_THROTTLE) {
      
      lastUpdateTime.current = now;
      lastChunkRef.current = { x: currentChunkX, z: currentChunkZ };
      
      // Update ref directly (no React re-render yet)
      const visibleChunkKeys = getVisibleChunkKeys(
        camera.position.x,
        camera.position.z,
        visualDistance
      );
      visibleChunksRef.current = new Set(visibleChunkKeys);
      
      // Trigger single re-render outside the frame loop
      setRenderTrigger(prev => prev + 1);
    }
  });
  
  // Memoize visible blocks based on stable trigger
  const visibleBlocks = useMemo(() => {
    const filtered: PlacedBlock[] = [];
    
    for (const chunkKey of visibleChunksRef.current) {
      const chunksBlocks = blocksByChunk.get(chunkKey);
      if (chunksBlocks) {
        filtered.push(...chunksBlocks);
      }
    }
    
    return filtered;
  }, [renderTrigger, blocksByChunk, blocks.length]);
  
  return <PlacedBlocks 
    blocks={visibleBlocks} 
    showOwnershipOutline={showOwnershipOutline} 
    currentUserId={currentUserId} 
    hoveredBlockId={hoveredBlockId || null}
    onMeshReady={onMeshReady}
  />;
}

export function FortressScene({ 
  settings, 
  onCoinHit, 
  wallPositions, 
  blockPlacementMode, 
  onBlockPlace,
  onModeChange,
  onOpenPanel,
  crosshairsEnabled,
  getBlockQuantity,
  selectedBlockType,
  panelOpen,
  onCycleBlock,
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
  toast
}: SceneProps) {
  // Shared cycle state ref for weather/sky/lighting
  const cycleStateRef = useRef({
    lightingPercentage: weatherSettings.lightingRange[0],
    cyclePosition: 0,
    isNight: false
  });
  
  // Bullet system
  const MAX_BULLETS = 20;
  const [bullets, setBullets] = useState<Array<{ position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number }>>([]);
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
  const [wispParticles, setWispParticles] = useState<WispParticle[]>([]);
  
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
  const { visualDistance, fogEnabled } = useBlocks();
  const { players, broadcastPosition, isConnected } = useMultiplayer('fortress-main');
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

  // Check for wisp hits
  const checkWispHit = useCallback(async () => {
    if (!wispMeshRef.current || !wispState) return false;
    
    const raycaster = new THREE.Raycaster();
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);
    raycaster.set(camera.position, direction);
    
    const intersects = raycaster.intersectObject(wispMeshRef.current);
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
          setWispParticles(prev => [...prev, ...newParticles]);
          
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
    setBullets(prev => {
      const newBullets = prev.slice(-MAX_BULLETS + 1);
      newBullets.push({
        position: new THREE.Vector3().copy(origin),
        direction: new THREE.Vector3().copy(direction),
        speed: 100,
        life: 3.0
      });
      return newBullets;
    });
    setShowCrosshairs(true);
  }, [checkWispHit]);

  // Frame loop for bullets and particles
  useFrame((state, delta) => {
    setBullets(prev => {
      if (prev.length === 0) return prev;
      
      const activeBullets = [];
      const coins = (window as any).getCoins ? (window as any).getCoins() : [];
      
      for (const bullet of prev) {
        bullet.position.addScaledVector(bullet.direction, bullet.speed * delta);
        bullet.life -= delta;
        
        if (bullet.life > 0) {
          let hit = false;
          
          for (const coin of coins) {
            if (coin.visible && coin.mesh) {
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
                break;
              }
            }
          }
          
          if (!hit) {
            activeBullets.push(bullet);
          }
        }
      }
      
      return activeBullets;
    });
    
    // Update wisp particles
    setWispParticles(prev => {
      if (prev.length === 0) return prev;
      
      return prev
        .map(particle => ({
          ...particle,
          position: particle.position.clone().add(
            particle.velocity.clone().multiplyScalar(delta)
          ),
          velocity: new THREE.Vector3(
            particle.velocity.x,
            particle.velocity.y - 9.8 * delta,
            particle.velocity.z
          ),
          life: particle.life - delta
        }))
        .filter(particle => particle.life > 0 && particle.position.y > 0);
    });
  });

  return (
    <>
      <FirstPersonControls 
        onShoot={handleShoot} 
        showCrosshairs={crosshairsEnabled}
        audioRefs={audioRefs.current}
        playAudio={playAudio}
        blockPlacementMode={blockPlacementMode}
        onBlockPlace={onBlockPlace}
        onOpenPanel={onOpenPanel}
        onModeChange={onModeChange}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        panelOpen={panelOpen}
        onCycleBlock={onCycleBlock}
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
      />
      
      <MultiplayerPlayers players={players} />
      <LocalPlayerAvatar isGunEquipped={crosshairsEnabled} />
      <FirstPersonArms isGunEquipped={crosshairsEnabled} isAiming={isAiming} />
      <SceneReflections />
      
      <DynamicLighting cycleStateRef={cycleStateRef} />
      <DynamicSky weatherSettings={weatherSettings} cycleStateRef={cycleStateRef} />

      <FortressStructure />
      <BillboardWalls wallPositions={wallPositions} isMoveMode={isMoveMode} />
      <CameraTrackedBlocks 
        blocks={blocks} 
        showOwnershipOutline={showOwnershipOutline && blockPlacementMode} 
        currentUserId={user?.id}
        hoveredBlockId={hoveredBlockId}
        onMeshReady={handleMeshReady}
      />
      <Waterfall
        flowSpeed={settings.flowSpeed} 
        msBetweeenDrops={settings.msBetweeenDrops} 
        colorPalette={settings.colorPalette} 
      />
      <Coins 
        coinRate={settings.coinRate} 
        coinSize={settings.coinSize} 
        flowSpeed={settings.flowSpeed}
        onGetCoins={() => []}
        coinImageUrl={coinImageUrl}
      />
      <Bullets bullets={bullets} />
      
      {wispState && (
        <WispBlock 
          positionRef={wispPositionRef}
          blockType={wispState.blockType}
          onMeshReady={(mesh) => { wispMeshRef.current = mesh; }}
        />
      )}
      
      {wispParticles.map((particle, i) => (
        <mesh key={i} position={particle.position.toArray()}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshBasicMaterial color={particle.color} transparent opacity={particle.life} />
        </mesh>
      ))}
      
      <FPSCounter isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />
    </>
  );
}
