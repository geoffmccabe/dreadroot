import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Perf } from 'r3f-perf';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { BillboardWalls } from '@/components/BillboardWalls';
import { PlacedBlocks } from '@/components/PlacedBlocks';
import { BlockPreview } from '@/components/BlockPreview';
import { getVisibleChunkKeys, CHUNK_SIZE } from '@/lib/chunkManager';
import { UserPanel } from '@/components/UserPanel';
import { AdminPanel } from '@/components/AdminPanel';
import { FPSCounter, FPSDisplay } from '@/components/FPSCounter';
import { useUserData } from '@/hooks/useUserData';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useTokenTheme } from '@/contexts/TokenThemeContext';
import { useToast } from '@/hooks/use-toast';
import { PlacedBlock } from '@/types/blocks';
import { Toaster } from '@/components/ui/toaster';
import { calculateBlockPlacement } from '@/lib/blockPlacement';
import { supabase } from '@/integrations/supabase/client';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { MultiplayerPlayers } from '@/components/MultiplayerPlayers';
import { LocalPlayerAvatar } from '@/components/LocalPlayerAvatar';
import { useRaycaster } from '@/hooks/useRaycaster';

// Camera-tracked block renderer with chunk culling
function CameraTrackedBlocks({ blocks, showOwnershipOutline, currentUserId, hoveredBlockId, onMeshReady }: { 
  blocks: PlacedBlock[];
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visualDistance } = useBlocks();
  
  // Use ref instead of state to avoid React re-renders in useFrame
  const cameraPositionRef = useRef({ x: 0, z: 0 });
  const [visibleChunks, setVisibleChunks] = useState<Set<string>>(new Set());
  const lastChunkRef = useRef({ x: 0, z: 0 });
  
  // Only update when camera moves to a different chunk
  useFrame(() => {
    const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
    
    if (currentChunkX !== lastChunkRef.current.x || 
        currentChunkZ !== lastChunkRef.current.z) {
      cameraPositionRef.current = {
        x: camera.position.x,
        z: camera.position.z
      };
      lastChunkRef.current = { x: currentChunkX, z: currentChunkZ };
      
      // Update visible chunks for filtering (only on chunk change, not every frame)
      const visibleChunkKeys = getVisibleChunkKeys(
        cameraPositionRef.current.x, 
        cameraPositionRef.current.z, 
        visualDistance
      );
      setVisibleChunks(new Set(visibleChunkKeys));
    }
  });
  
  // Filter blocks based on visible chunks (only recalculates when visibleChunks changes)
  const visibleBlocks = useMemo(() => {
    const filtered: PlacedBlock[] = [];
    
    for (const chunkKey of visibleChunks) {
      const chunksBlocks = blocksByChunk.get(chunkKey);
      if (chunksBlocks) {
        filtered.push(...chunksBlocks);
      }
    }
    
    return filtered;
  }, [visibleChunks, blocksByChunk, blocks.length, visualDistance]);
  
  return <PlacedBlocks 
    blocks={visibleBlocks} 
    showOwnershipOutline={showOwnershipOutline} 
    currentUserId={currentUserId} 
    hoveredBlockId={hoveredBlockId || null}
    onMeshReady={onMeshReady}
  />;
}

// Sky component with space texture
// Helper function to interpolate between colors
function interpolateColor(color1: number, color2: number, factor: number): number {
  const c1 = { r: (color1 >> 16) & 0xff, g: (color1 >> 8) & 0xff, b: color1 & 0xff };
  const c2 = { r: (color2 >> 16) & 0xff, g: (color2 >> 8) & 0xff, b: color2 & 0xff };
  
  const r = Math.round(c1.r + (c2.r - c1.r) * factor);
  const g = Math.round(c1.g + (c2.g - c1.g) * factor);
  const b = Math.round(c1.b + (c2.b - c1.b) * factor);
  
  return (r << 16) | (g << 8) | b;
}

// Calculate sky color based on lighting percentage (100% = bright blue day, 0% = black night)
function getSkyColor(lightingPercentage: number): number {
  // Linear interpolation from black (0x000000) at 0% to bright blue (0x87ceeb) at 100%
  const dayColor = 0x87ceeb;
  const nightColor = 0x000000;
  return interpolateColor(nightColor, dayColor, lightingPercentage / 100);
}

function SkyTexture({ 
  cycleStateRef, 
  weatherSettings,
  onRefsReady 
}: { 
  cycleStateRef: React.MutableRefObject<{ lightingPercentage: number; cyclePosition: number; isNight: boolean }>;
  weatherSettings: { lightingRange: [number, number]; cycleDuration: number };
  onRefsReady: (refs: { skyMeshRef: React.RefObject<THREE.Mesh>; starMeshRef: React.RefObject<THREE.Mesh> }) => void;
}) {
  const { scene } = useThree();
  const starMeshRef = useRef<THREE.Mesh | null>(null);
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  
  useEffect(() => {
    const textureLoader = new THREE.TextureLoader();
    const skyGeo = new THREE.SphereGeometry(320, 64, 32);
    
    // Layer 1: Solid color sky sphere
    const skyColorMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      color: 0x000000,
      fog: false,
      transparent: true,
      opacity: 0
    });
    const skyColorMesh = new THREE.Mesh(skyGeo.clone(), skyColorMat);
    skyMeshRef.current = skyColorMesh;
    scene.add(skyColorMesh);
    
    // Layer 2: Star texture sphere (slightly smaller to avoid z-fighting)
    textureLoader.load('/space_night_sky.webp', (loadedTexture) => {
      loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
      loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
      
      // Remove 3 pixels from each edge to eliminate white seam artifacts
      const img = loadedTexture.image;
      const cropPixels = 3;
      const cropX = (cropPixels / img.width) * 2; // *2 because we crop both sides
      const cropY = (cropPixels / img.height) * 2;
      
      loadedTexture.repeat.set(1 - cropX, 1 - cropY);
      loadedTexture.offset.set(cropX / 2, cropY / 2);
      
      textureRef.current = loadedTexture;
      
      const starGeo = new THREE.SphereGeometry(319, 64, 32);
      const starMat = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: loadedTexture,
        transparent: true,
        opacity: 1,
        fog: false,
        blending: THREE.AdditiveBlending // Stars add light on top
      });
      
      const starMesh = new THREE.Mesh(starGeo, starMat);
      starMeshRef.current = starMesh;
      scene.add(starMesh);
      
      console.log('✓ Stars loaded:', loadedTexture.image.width, 'x', loadedTexture.image.height);
    });
    
    // Notify parent of refs
    onRefsReady({ skyMeshRef, starMeshRef });
    
    return () => {
      if (skyMeshRef.current) {
        scene.remove(skyMeshRef.current);
        skyMeshRef.current.geometry.dispose();
        (skyMeshRef.current.material as THREE.Material).dispose();
      }
      if (starMeshRef.current) {
        scene.remove(starMeshRef.current);
        starMeshRef.current.geometry.dispose();
        (starMeshRef.current.material as THREE.Material).dispose();
      }
      textureRef.current?.dispose();
    };
  }, [scene, onRefsReady]);
  
  // Sky updates moved to consolidated useFrame in DynamicSky
  
  return null;
}

// Star field removed - using space texture instead

// Dynamic sky controller with CONSOLIDATED environment useFrame loop
function DynamicSky({ 
  weatherSettings,
  cycleStateRef 
}: {
  weatherSettings: {
    lightingRange: [number, number];
    cycleDuration: number;
  };
  cycleStateRef: React.MutableRefObject<{ lightingPercentage: number; cyclePosition: number; isNight: boolean }>;
}) {
  const [isNight, setIsNight] = useState(false);
  const skyRefs = useRef<{ skyMeshRef: React.RefObject<THREE.Mesh>; starMeshRef: React.RefObject<THREE.Mesh> } | null>(null);
  
  const handleRefsReady = useCallback((refs: { skyMeshRef: React.RefObject<THREE.Mesh>; starMeshRef: React.RefObject<THREE.Mesh> }) => {
    skyRefs.current = refs;
  }, []);
  
  // CONSOLIDATED: Weather + Sky in ONE useFrame
  useFrame(() => {
    // 1. Update weather cycle
    const cycleDurationMs = weatherSettings.cycleDuration * 60 * 1000;
    const currentTime = Date.now();
    const cyclePosition = (currentTime % cycleDurationMs) / cycleDurationMs;
    
    const sineWave = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
    const [minLighting, maxLighting] = weatherSettings.lightingRange;
    const lightingPercentage = minLighting + (maxLighting - minLighting) * sineWave;
    
    const newIsNight = lightingPercentage < 50;
    
    cycleStateRef.current = { lightingPercentage, cyclePosition, isNight: newIsNight };
    
    if (newIsNight !== isNight) {
      setIsNight(newIsNight);
    }
    
    // 2. Update sky transitions
    if (skyRefs.current) {
      const skyMesh = skyRefs.current.skyMeshRef.current;
      const starMesh = skyRefs.current.starMeshRef.current;
      
      if (skyMesh) {
        const mat = skyMesh.material as THREE.MeshBasicMaterial;
        const t = lightingPercentage / 100;
        mat.color.setRGB(135/255 * t, 206/255 * t, 235/255 * t);
        mat.opacity = t;
      }
      
      if (starMesh) {
        const mat = starMesh.material as THREE.MeshBasicMaterial;
        if (lightingPercentage <= 30) {
          mat.opacity = 1.0 - (lightingPercentage / 30);
        } else {
          mat.opacity = 0;
        }
      }
    }
  });
  
  return <SkyTexture cycleStateRef={cycleStateRef} weatherSettings={weatherSettings} onRefsReady={handleRefsReady} />;
}

// First person controls component
function FirstPersonControls({ 
  onShoot, 
  showCrosshairs, 
  audioRefs, 
  playAudio,
  blockPlacementMode,
  onBlockPlace,
  onOpenPanel,
  onModeChange,
  getBlockQuantity,
  selectedBlockType,
  panelOpen,
  onCycleBlock,
  blocks,
  onBlockRain,
  userRoles,
  broadcastPosition,
  onBlockRemove,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  setHoveredBlockId,
  instancedMeshesRef,
  meshesArrayCache,
  meshToBlockTypeCache,
  blocksByTypeAndUser
}: {
  onShoot?: (origin: THREE.Vector3, direction: THREE.Vector3) => void; 
  showCrosshairs: boolean;
  audioRefs: {
    pistolCocking: HTMLAudioElement;
    pistolHolster: HTMLAudioElement;
    gunshot: HTMLAudioElement;
    coinHit: HTMLAudioElement;
  };
  playAudio: (audio: HTMLAudioElement) => Promise<void>;
  blockPlacementMode: boolean;
  onBlockPlace?: (position: THREE.Vector3) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'inventory' | 'store') => void;
  onModeChange: (mode: 'shooting' | 'building' | null) => void;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  blocks: PlacedBlock[];
  onBlockRain: () => void;
  userRoles: string[];
  broadcastPosition?: (position: THREE.Vector3, yaw: number, pitch: number) => void;
  onBlockRemove?: (blockId: string) => Promise<void>;
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId: string | null;
  setHoveredBlockId: (id: string | null) => void;
  instancedMeshesRef: React.MutableRefObject<Map<string, THREE.InstancedMesh>>;
  meshesArrayCache: React.MutableRefObject<THREE.InstancedMesh[]>;
  meshToBlockTypeCache: React.MutableRefObject<Map<THREE.InstancedMesh, string>>;
  blocksByTypeAndUser: React.MutableRefObject<Map<string, PlacedBlock[]>>;
}) {
  const { camera, gl } = useThree();
  const { raycastMeshes } = useRaycaster();
  const isLocked = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const keys = useRef({
    w: false, s: false, a: false, d: false,
    shift: false, space: false, r: false, ctrl: false,
    previouslyCtrl: false, rightMouse: false
  });
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const onGround = useRef(true);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const lastGroundCheck = useRef(0);
  const stuckTimer = useRef(0);
  const lastPositionLog = useRef(0);
  
  // Reusable Vector3 objects to prevent garbage collection
  const forwardVecRef = useRef(new THREE.Vector3());
  const rightVecRef = useRef(new THREE.Vector3());
  const deltaMovementRef = useRef(new THREE.Vector3());
  
  // Use blocks from props instead of context (context doesn't cross Canvas boundary)
  const existingBlocks = blocks;
  
  // Firing rate limiting to prevent performance issues
  const lastFireTime = useRef(0);
  const FIRE_RATE_LIMIT = 150; // Minimum 150ms between shots

  // Cache for block collision boxes to avoid recreating them on every render
  const blockCollisionCache = useRef(new Map<string, THREE.Box3>());

  // Collision boxes for fortress walls and placed blocks
  const colliders = useMemo(() => {
    console.log('[Colliders] Building colliders with', existingBlocks.length, 'blocks');
    const cliffW = 40, cliffH = 20, frontT = 2;
    const courtyardDepth = 30, frontZ = -8;
    const openingHalfW = 2;
    
    const fortressColliders = [
      // Left pillar
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2, 0, frontZ - frontT/2),
        new THREE.Vector3(-cliffW/4 - openingHalfW/2 + (cliffW/2 - openingHalfW)/2, cliffH, frontZ + frontT/2)
      ),
      // Right pillar  
      new THREE.Box3(
        new THREE.Vector3(cliffW/4 + openingHalfW/2 - (cliffW/2 - openingHalfW)/2, 0, frontZ - frontT/2),
        new THREE.Vector3(cliffW/2, cliffH, frontZ + frontT/2)
      ),
      // Side walls
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
        new THREE.Vector3(-cliffW/2 + 1, cliffH, frontZ - frontT)
      ),
      new THREE.Box3(
        new THREE.Vector3(cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
        new THREE.Vector3(cliffW/2 + 1, cliffH, frontZ - frontT)
      ),
      // Back wall
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2, 0, frontZ - courtyardDepth - frontT - 1),
        new THREE.Vector3(cliffW/2, cliffH, frontZ - courtyardDepth - frontT + 1)
      )
    ];

    // Incrementally update block colliders cache
    const currentBlockIds = new Set(existingBlocks.map(b => b.id));
    
    // Remove collision boxes for deleted blocks
    for (const id of blockCollisionCache.current.keys()) {
      if (!currentBlockIds.has(id)) {
        blockCollisionCache.current.delete(id);
      }
    }
    
    // Add collision boxes for new blocks only
    for (const block of existingBlocks) {
      if (!blockCollisionCache.current.has(block.id)) {
        // Database stores corner position, blocks are 1x1x1 from position to position+1
        blockCollisionCache.current.set(block.id, new THREE.Box3(
          new THREE.Vector3(block.position_x, block.position_y, block.position_z),
          new THREE.Vector3(block.position_x + 1, block.position_y + 1, block.position_z + 1)
        ));
      }
    }
    
    const result = [...fortressColliders, ...Array.from(blockCollisionCache.current.values())];
    return result;
  }, [existingBlocks]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't process key events when dialogs are open or input fields are focused
    if (panelOpen || 
        document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    
    switch (event.code) {
    case 'KeyI':
      event.preventDefault();
      onOpenPanel('inventory');
      break;
    case 'KeyW':
    case 'ArrowUp':
      keys.current.w = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.current.s = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
        keys.current.a = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.current.d = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.current.shift = true;
        break;
      case 'Space':
        keys.current.space = true;
        event.preventDefault();
        break;
      case 'ControlLeft':
        keys.current.ctrl = true;
        break;
      case 'KeyR':
        // Check for Shift+R for block rain
        if (event.shiftKey) {
          event.preventDefault();
          onBlockRain();
        } else if (!blockPlacementMode) {
          // In gun/default mode - toggle shooting crosshairs
          const newCrosshairsState = !showCrosshairs;
          onModeChange(newCrosshairsState ? 'shooting' : null);
          
          // Play appropriate gun sound using preloaded audio
          const audio = newCrosshairsState ? audioRefs.pistolCocking : audioRefs.pistolHolster;
          playAudio(audio);
        } else {
          // In block mode - switch to gun mode with cocking sound
          console.log('R pressed in block mode, switching to gun mode');
          onModeChange('shooting');
          
          // Play gun cocking sound
          playAudio(audioRefs.pistolCocking);
        }
        break;
      case 'KeyB':
        // Toggle block placement mode
        console.log('B key pressed - current blockPlacementMode:', blockPlacementMode);
        
        if (blockPlacementMode) {
          // Exit block mode
          console.log('Exiting block mode');
          onModeChange(null);
        } else {
          // Enter block mode - let the parent component handle inventory checking
          console.log('Attempting to enter block mode');
          onModeChange('building');
        }
        break;
      case 'KeyO':
        event.preventDefault();
        onOpenPanel('store');
        break;
      case 'BracketLeft': // [ key - cycle to previous block
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('prev');
        }
        break;
      case 'BracketRight': // ] key - cycle to next block
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('next');
        }
        break;
      case 'Escape':
        if (isLocked.current) {
          document.exitPointerLock();
        }
        break;
    }
  }, [crosshairsEnabled, onModeChange, onOpenPanel, getBlockQuantity, selectedBlockType, panelOpen]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Don't process key events when dialogs are open or input fields are focused
    if (panelOpen || 
        document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.current.w = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.current.s = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.current.a = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.current.d = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.current.shift = false;
        break;
      case 'Space':
        keys.current.space = false;
        break;
      case 'ControlLeft':
        keys.current.ctrl = false;
        break;
    }
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    
    const sensitivity = 0.002;
    yaw.current -= event.movementX * sensitivity;
    pitch.current -= event.movementY * sensitivity;
    
    const maxPitch = Math.PI / 2 - 0.01;
    pitch.current = Math.max(-maxPitch, Math.min(maxPitch, pitch.current));
    
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
  }, [camera]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!isLocked.current || !blockPlacementMode) return;
    
    event.preventDefault();
    const direction = event.deltaY > 0 ? 'next' : 'prev';
    onCycleBlock(direction);
  }, [blockPlacementMode, onCycleBlock]);

  const handleClick = useCallback(() => {
    console.log('Click detected, isLocked:', isLocked.current, 'blockPlacementMode:', blockPlacementMode);
    
    if (!isLocked.current) {
      gl.domElement.requestPointerLock();
      return;
    }
    
    // If in block mode with ownership outline shown and a block is hovered, remove it
    if (blockPlacementMode && showOwnershipOutline && hoveredBlockId && onBlockRemove) {
      console.log('Removing hovered block:', hoveredBlockId);
      onBlockRemove(hoveredBlockId);
      setHoveredBlockId(null);
      return;
    }
    
    if (blockPlacementMode && onBlockPlace) {
      console.log('Attempting block placement...');
      // Minecraft-style block placement with surface detection
      const raycaster = new THREE.Raycaster();
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(camera.quaternion);
      raycaster.set(camera.position, direction);
      
      
      // Use centralized block placement system (Phase 2)
      const placementResult = calculateBlockPlacement({
        camera,
        existingBlocks: existingBlocks || [],
        maxDistance: 5,
      });
      
      console.log('Block placement result:', placementResult);
      
      if (placementResult.isValid && placementResult.position) {
        console.log('Valid placement, calling onBlockPlace with selectedBlockType:', selectedBlockType);
        onBlockPlace(placementResult.position);
      } else {
        console.log('Invalid placement:', placementResult.reason);
        // Show user feedback for invalid placement
        if (placementResult.reason === 'fortress') console.log('Too close to fortress');
        if (placementResult.reason === 'waterfall') console.log('Blocking waterfall');
        if (placementResult.reason === 'overlap') console.log('Block overlap detected');
        if (placementResult.reason === 'no-surface') console.log('No surface found within range');
      }
    } else if (showCrosshairs && onShoot) {
      // Implement firing rate limiting to prevent performance issues
      const now = Date.now();
      if (now - lastFireTime.current < FIRE_RATE_LIMIT) {
        return; // Prevent rapid firing
      }
      lastFireTime.current = now;
      
      // Fire bullet
      const shootDirection = new THREE.Vector3(0, 0, -1);
      shootDirection.applyQuaternion(camera.quaternion);
      onShoot(camera.position.clone(), shootDirection);
      
      // Play gunshot sound using preloaded audio
      playAudio(audioRefs.gunshot);
    }
  }, [gl, showCrosshairs, onShoot, camera, blockPlacementMode, onBlockPlace, existingBlocks, selectedBlockType, showOwnershipOutline, hoveredBlockId, onBlockRemove]);

  // Right-click handler for selecting blocks to remove
  const handleRightClick = useCallback((event: MouseEvent) => {
    if (!isLocked.current || !blockPlacementMode || !showOwnershipOutline) return;
    event.preventDefault();
  }, [blockPlacementMode, showOwnershipOutline]);

  // Mouse down/up handlers for right-click hold
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    
    if (event.button === 2) { // Right mouse button
      keys.current.rightMouse = true;
    }
  }, []);

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (event.button === 2) { // Right mouse button
      keys.current.rightMouse = false;
      // Clear hovered block when releasing right mouse
      setHoveredBlockId(null);
    }
  }, []);

  const handlePointerLockChange = useCallback(() => {
    isLocked.current = document.pointerLockElement === gl.domElement;
  }, [gl]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('wheel', handleWheel);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    gl.domElement.addEventListener('click', handleClick);
    gl.domElement.addEventListener('contextmenu', handleRightClick);
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    gl.domElement.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      gl.domElement.removeEventListener('click', handleClick);
      gl.domElement.removeEventListener('contextmenu', handleRightClick);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      gl.domElement.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleKeyDown, handleKeyUp, handleMouseMove, handleWheel, handlePointerLockChange, handleClick, handleRightClick, handleMouseDown, handleMouseUp, gl.domElement]);

  // Cache blocks by type and user for fast lookup
  useEffect(() => {
    const cache = new Map<string, PlacedBlock[]>();
    blocks.forEach(block => {
      if (block.user_id === currentUserId) {
        const key = block.block_type;
        if (!cache.has(key)) {
          cache.set(key, []);
        }
        cache.get(key)!.push(block);
      }
    });
    blocksByTypeAndUser.current = cache;
  }, [blocks, currentUserId]);

  // Frame counter for proper throttling
  const hoverCheckFrameCounter = useRef(0);

  useFrame((state, delta) => {
    // Hover detection for block mode - OPTIMIZED with cached lookups
    // Throttle to every 10 frames (at 60fps = 6 checks/sec instead of 60/sec)
    if (blockPlacementMode && currentUserId && showOwnershipOutline && keys.current.rightMouse) {
      hoverCheckFrameCounter.current++;
      // Proper throttle: only raycast every 10th frame
      if (hoverCheckFrameCounter.current % 10 === 0) {
        const meshes = meshesArrayCache.current;
        
        if (meshes.length > 0) {
          const result = raycastMeshes(meshes, 5);
          
          if (result && result.instanceId !== undefined) {
            // Find the block at this instanceId using cached lookup
            const mesh = result.object as THREE.InstancedMesh;
            const blockType = meshToBlockTypeCache.current.get(mesh);
            
            if (blockType) {
              // Get blocks of this type using cached map
              const blocksOfType = blocksByTypeAndUser.current.get(blockType);
              if (blocksOfType && blocksOfType[result.instanceId]) {
                setHoveredBlockId(blocksOfType[result.instanceId].id);
              } else {
                setHoveredBlockId(null);
              }
            } else {
              setHoveredBlockId(null);
            }
          } else {
            setHoveredBlockId(null);
          }
        } else {
          setHoveredBlockId(null);
        }
      }
    } else if (hoveredBlockId) {
      setHoveredBlockId(null);
    }
    
    // Movement input
    direction.current.set(0, 0, 0);
    if (keys.current.w) direction.current.z += 1;
    if (keys.current.s) direction.current.z -= 1;
    if (keys.current.a) direction.current.x -= 1;
    if (keys.current.d) direction.current.x += 1;
    direction.current.normalize();

    // Speed calculation - reduced when crawling
    const baseSpeed = 4.0;
    const crawlSpeed = baseSpeed * 0.6; // 60% speed when crawling
    const runSpeed = keys.current.ctrl ? crawlSpeed : (keys.current.shift ? 8.0 : baseSpeed);
    
    // Apply movement (reuse vector objects to prevent garbage collection)
    const forward = forwardVecRef.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = rightVecRef.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    
    const deltaMovement = deltaMovementRef.current.set(0, 0, 0);
    deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * delta);
    deltaMovement.addScaledVector(right, direction.current.x * runSpeed * delta);

    // Gravity and jumping - variable jump height based on role
    velocity.current.y -= 9.8 * delta;
    
    // Allow jump if on ground OR if stuck for >0.3 seconds (desperation jump)
    const canJump = (onGround.current || stuckTimer.current > 0.3) && !keys.current.ctrl;
    
    if (keys.current.space && canJump) {
      // Calculate jump velocity based on desired height
      // Formula: v = sqrt(2 * g * h) where g=9.8, h=jump height in blocks
      let jumpHeight = 1.25; // Base: 1.25 blocks
      if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
        jumpHeight = 2.5; // Admin boost: 2.5 blocks
      }
      velocity.current.y = Math.sqrt(2 * 9.8 * jumpHeight);
      onGround.current = false;
      stuckTimer.current = 0; // Reset stuck timer after successful jump
    }
    deltaMovement.y += velocity.current.y * delta;

    // Player dimensions
    const playerRadius = 0.4;
    const isCrawling = keys.current.ctrl;
    const standingHeight = 1.6;
    const crawlingHeight = 0.8;
    const playerHeight = isCrawling ? crawlingHeight : standingHeight;
    
    // Helper function to create player bounding box
    const createPlayerBox = (pos: THREE.Vector3) => {
      return new THREE.Box3(
        new THREE.Vector3(pos.x - playerRadius, pos.y - playerHeight, pos.z - playerRadius),
        new THREE.Vector3(pos.x + playerRadius, pos.y, pos.z + playerRadius)
      );
    };

    // Helper function to check collision on a specific axis
    const checkAxisCollision = (pos: THREE.Vector3, isHorizontal: boolean = false) => {
      const playerBox = createPlayerBox(pos);
      
      for (const collider of colliders) {
        // For horizontal movement, skip blocks the player is standing on top of
        if (isHorizontal) {
          const standingOnBlock = (playerBox.min.y >= collider.max.y - 0.25) && (playerBox.min.y <= collider.max.y + 0.25);
          if (standingOnBlock) {
            // Debug occasionally
            if (Math.random() < 0.01) {
              console.log('[Standing Check]', {
                playerMinY: playerBox.min.y,
                colliderMaxY: collider.max.y,
                diff: Math.abs(playerBox.min.y - collider.max.y),
                skipping: true
              });
            }
            continue;
          }
        }
        
        if (playerBox.intersectsBox(collider)) {
          return collider;
        }
      }
      return null;
    };

    // Store previous position and track collisions
    const prevPosition = camera.position.clone();
    // Store original position BEFORE any collision resolution for Y-axis testing
    const originalPos = camera.position.clone();
    let xBlocked = false;
    let zBlocked = false;

    // PER-AXIS COLLISION DETECTION (Standard for voxel games)
    // X-axis movement and collision
    if (deltaMovement.x !== 0) {
      const testPos = camera.position.clone();
      testPos.x += deltaMovement.x;
      
      const collision = checkAxisCollision(testPos, true);
      if (collision) {
        camera.position.x = prevPosition.x;
        velocity.current.x = 0;
        xBlocked = true;
      } else {
        camera.position.x = testPos.x;
      }
    }

    // Y-axis movement and collision (test from ORIGINAL position to prevent X/Z interference)
    if (deltaMovement.y !== 0) {
      const testPos = originalPos.clone();
      testPos.y += deltaMovement.y;
      // Use original position so X/Z collision doesn't affect Y collision detection
      
      // Ground collision check
      if (testPos.y < playerHeight) {
        camera.position.y = playerHeight;
        velocity.current.y = 0;
        onGround.current = true;
      } else {
        const collision = checkAxisCollision(testPos, false);
        if (collision) {
          console.log('[Y-COLLISION]', {
            time: state.clock.elapsedTime.toFixed(2),
            velocity_y: velocity.current.y.toFixed(3),
            currentY: camera.position.y.toFixed(3),
            testY: testPos.y.toFixed(3),
            collision_min_y: collision.min.y.toFixed(3),
            collision_max_y: collision.max.y.toFixed(3),
            action: velocity.current.y < 0 ? 'FALLING' : 'JUMPING'
          });
          
          if (velocity.current.y < 0) {
            // Falling - land on top
            camera.position.y = collision.max.y + playerHeight;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            // Jumping - hit ceiling with buffer to prevent rapid collision
            camera.position.y = collision.min.y - 0.01;
            velocity.current.y = 0;
            // Don't set onGround when hitting ceiling
          }
        } else {
          camera.position.y = testPos.y;
          onGround.current = false;
        }
      }
    }

    // Z-axis movement and collision
    if (deltaMovement.z !== 0) {
      const testPos = camera.position.clone();
      testPos.z += deltaMovement.z;
      
      const collision = checkAxisCollision(testPos, true);
      if (collision) {
        camera.position.z = prevPosition.z;
        velocity.current.z = 0;
        zBlocked = true;
      } else {
        camera.position.z = testPos.z;
      }
    }

    // DISABLED step-up logic to prevent wall hooking
    // TODO: Implement proper step-up that doesn't hook onto edges
    
    // Detect if player is stuck (all horizontal movement blocked)
    const isStuckHorizontally = xBlocked && zBlocked && 
      (keys.current.w || keys.current.s || keys.current.a || keys.current.d);
    
    // Track stuck time for desperation jump
    if (isStuckHorizontally) {
      stuckTimer.current += delta;
    } else {
      stuckTimer.current = 0;
    }
    
    // Position tracking for debugging - log every 0.1 seconds while moving
    const isMoving = keys.current.w || keys.current.s || keys.current.a || keys.current.d || 
                     keys.current.space || Math.abs(velocity.current.y) > 0.1;
    if (isMoving && state.clock.elapsedTime - lastPositionLog.current > 0.1) {
      console.log('[POSITION TRACK]', {
        time: state.clock.elapsedTime.toFixed(2),
        pos: {
          x: camera.position.x.toFixed(3),
          y: camera.position.y.toFixed(3),
          z: camera.position.z.toFixed(3)
        },
        velocity: {
          x: velocity.current.x.toFixed(3),
          y: velocity.current.y.toFixed(3),
          z: velocity.current.z.toFixed(3)
        },
        state: {
          onGround: onGround.current,
          xBlocked,
          zBlocked,
          isStuck: isStuckHorizontally,
          stuckTime: stuckTimer.current.toFixed(2)
        },
        keys: {
          w: keys.current.w,
          s: keys.current.s,
          a: keys.current.a,
          d: keys.current.d,
          space: keys.current.space
        }
      });
      lastPositionLog.current = state.clock.elapsedTime;
    }
    
    // ACTUAL ground detection - check every frame if there's a block beneath the player
    const feetY = camera.position.y - playerHeight;
    
    // Check if player is on the ground level (y = 0)
    const onGroundLevel = feetY <= 0.05 && Math.abs(velocity.current.y) < 0.1;
    
    // When stuck, check a larger area below feet to be more lenient
    const checkDistance = isStuckHorizontally ? 0.15 : 0.05;
    const feetCheckPos = camera.position.clone();
    feetCheckPos.y = camera.position.y - playerHeight - checkDistance;
    const hasBlockBeneath = checkAxisCollision(feetCheckPos, false);
    
    // Player is on ground if on ground level OR there's a block beneath them
    if (onGroundLevel || (hasBlockBeneath && Math.abs(velocity.current.y) < 0.1)) {
      onGround.current = true;
    } else if (isStuckHorizontally) {
      // If stuck and trying to move, assume on ground to allow jump escape
      onGround.current = true;
    } else {
      // No block beneath and not on ground level = falling
      onGround.current = false;
    }
    
    // Broadcast position to multiplayer (throttled internally)
    if (broadcastPosition) {
      broadcastPosition(camera.position, yaw.current, pitch.current);
    }
  });

  return null;
}

// Waterfall component with stretching drops
function Waterfall({ flowSpeed = 1.2, msBetweeenDrops = 10, colorPalette }: { 
  flowSpeed: number; 
  msBetweeenDrops: number; 
  colorPalette: Array<{ hex: string; weight: number; }>;
}) {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const activeDropsRef = useRef<Array<{
    position: THREE.Vector3;
    velocity: number;
    stretchFactor: number;
    color: THREE.Color;
    active: boolean;
  }>>([]);
  const timeAccumulatorRef = useRef(0);
  const maxDrops = 20000; // Massive pool to never run out
  
  const fall = {
    width: 6, // Made 2m wider (1m on each side)
    depth: 0.6,
    topY: 19.95, // cliffH - 0.05
    bottomY: 0.2,
    centerX: 0,
    z: -6.8 // Moved closer to fortress wall
  };

  // Water drop colors from props with proper normalization
  const dropPaletteColors = useMemo(() => {
    return colorPalette.map(item => ({
      color: new THREE.Color(item.hex),
      weight: item.weight,
      hex: item.hex
    }));
  }, [colorPalette]);

  // Create cumulative distribution function (matching original HTML exactly)
  const dropCDF = useMemo(() => {
    const cdf = [];
    let sum = 0;
    for (const p of dropPaletteColors) {
      sum += p.weight;
      cdf.push(sum);
    }
    // Normalize to ensure total is 1
    for (let i = 0; i < cdf.length; i++) {
      cdf[i] /= sum;
    }
    return cdf;
  }, [dropPaletteColors]);

  const pickColor = useCallback(() => {
    const r = Math.random();
    for (let i = 0; i < dropCDF.length; i++) {
      if (r <= dropCDF[i]) {
        const color = new THREE.Color(dropPaletteColors[i].hex);
        // Darken colors to compensate for additive blending and lighting
        color.multiplyScalar(0.4);
        return color;
      }
    }
    // Fallback to last color
    const color = new THREE.Color(dropPaletteColors[dropPaletteColors.length - 1].hex);
    color.multiplyScalar(0.4);
    return color;
  }, [dropCDF, dropPaletteColors]);

  // Initialize drops array
  useEffect(() => {
    activeDropsRef.current = Array.from({ length: maxDrops }, () => ({
      position: new THREE.Vector3(0, fall.topY, fall.z),
      velocity: 0,
      stretchFactor: 10, // All drops stretch to 10x
      color: pickColor(),
      active: false
    }));
  }, [pickColor]);

  // Spawn a new drop at the top
  const spawnDrop = useCallback(() => {
    const inactiveDrop = activeDropsRef.current.find(drop => !drop.active);
    if (inactiveDrop) {
      inactiveDrop.active = true;
      inactiveDrop.position.set(
        fall.centerX + (Math.random() - 0.5) * fall.width, // Random X across width
        fall.topY, // Always start at top
        fall.z + (Math.random() - 0.5) * fall.depth // Random Z within depth
      );
      inactiveDrop.velocity = Math.random() * 2 + 1; // Initial velocity
      inactiveDrop.stretchFactor = 10; // Always stretch to 10x
      inactiveDrop.color = pickColor(); // New random color
    }
  }, [pickColor]);

  // Reuse objects to avoid garbage collection
  const matrixRef = useRef(new THREE.Matrix4());
  const positionRef = useRef(new THREE.Vector3());
  const rotationRef = useRef(new THREE.Euler());
  const scaleRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const colorRef = useRef(new THREE.Color());

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;
    
    // Accumulate time and spawn continuously
    timeAccumulatorRef.current += delta * 1000;
    
    while (timeAccumulatorRef.current >= msBetweeenDrops) {
      timeAccumulatorRef.current -= msBetweeenDrops;
      spawnDrop();
    }
    
    // Reuse object references instead of creating new ones
    const matrix = matrixRef.current;
    const position = positionRef.current;
    const rotation = rotationRef.current;
    const scale = scaleRef.current;
    const color = colorRef.current;
    
    const mul = flowSpeed;
    let activeCount = 0;
    
    // Update all active drops
    activeDropsRef.current.forEach((drop, i) => {
      if (!drop.active) return;
      
      // Apply gravity acceleration
      drop.velocity += 9.8 * mul * delta;
      drop.position.y -= drop.velocity * delta;
      
      // Check if drop reached bottom
      if (drop.position.y <= fall.bottomY) {
        drop.active = false;
        return;
      }
      
      // Calculate stretch based on fall progress
      const fallProgress = 1 - (drop.position.y - fall.bottomY) / (fall.topY - fall.bottomY);
      const stretchMultiplier = 1 + (drop.stretchFactor - 1) * fallProgress;
      
      // Scale: start as square (0.1x0.1x0.1), stretch only in Y to 10x (0.1x1.0x0.1)
      const baseSize = 0.1;
      const scaleY = baseSize * stretchMultiplier;
      scale.set(baseSize, scaleY, baseSize);
      
      // Adjust position so bottom edge falls at constant rate (not center)
      // As drop stretches, center moves up by half the stretch amount
      const yOffset = (scaleY - baseSize) / 2;
      position.set(drop.position.x, drop.position.y + yOffset, drop.position.z);
      rotation.set(0, 0, 0);
      
      quaternionRef.current.setFromEuler(rotation);
      matrix.compose(position, quaternionRef.current, scale);
      instancedMeshRef.current.setMatrixAt(activeCount, matrix);
      
      // Set color for this instance
      instancedMeshRef.current.setColorAt(activeCount, drop.color);
      
      activeCount++;
    });
    
    // Update instance count to only render active drops
    instancedMeshRef.current.count = activeCount;
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
    if (instancedMeshRef.current.instanceColor) {
      instancedMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh 
      ref={instancedMeshRef} 
      args={[undefined, undefined, maxDrops]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial 
        transparent
        opacity={0.8}
        depthWrite={false}
        depthTest={true}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

// Fortress structure
function Fortress() {
  const cliffW = 40, cliffH = 20, frontT = 2;
  const courtyardDepth = 30, frontZ = -8;
  const openingHalfW = 2, openingH = 5;

  // Track textures for disposal
  const [cliffTexture, setCliffTexture] = useState<THREE.Texture | null>(null);
  const [grassTexture, setGrassTexture] = useState<THREE.Texture | null>(null);
  const cliffTextureRef = useRef<THREE.Texture | null>(null);
  const grassTextureRef = useRef<THREE.Texture | null>(null);
  const clonedTexturesRef = useRef<THREE.Texture[]>([]);

  // Load base textures
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    
    loader.load('/cliff_texture_seamless.webp', (texture) => {
      cliffTextureRef.current = texture;
      setCliffTexture(texture);
    });
    
    loader.load('/grass_texture_seamless.webp', (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(40, 40);
      grassTextureRef.current = texture;
      setGrassTexture(texture);
    });
    
    return () => {
      // Dispose base textures
      if (cliffTextureRef.current) {
        cliffTextureRef.current.dispose();
        cliffTextureRef.current = null;
      }
      if (grassTextureRef.current) {
        grassTextureRef.current.dispose();
        grassTextureRef.current = null;
      }
      // Dispose all cloned textures
      clonedTexturesRef.current.forEach(tex => tex.dispose());
      clonedTexturesRef.current = [];
    };
  }, []);

  // Create individual textures for each wall with proper scaling
  const frontTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.6, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const topTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.8, 3);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const sideTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const backTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const courtyardTexture = useMemo(() => {
    if (!grassTexture) return null;
    const texture = grassTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Calculate repeat based on the same scale as main ground (260x260 with 40x40 repeat = 6.5 units per repeat)
    // For courtyard: (cliffW-4) = 36, (courtyardDepth-2) = 28
    texture.repeat.set((cliffW-4)/6.5, (courtyardDepth-2)/6.5);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [grassTexture]);

  return (
    <group>
      {/* Wait for textures to load before rendering */}
      {!grassTexture || !frontTexture || !topTexture || !sideTexture || !backTexture || !courtyardTexture ? null : (
        <>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial map={grassTexture} metalness={0} roughness={1} />
      </mesh>

      {/* Front wall - Left pillar (extended to connect with side wall) */}
      <mesh position={[-(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Right pillar (extended to connect with side wall) */}
      <mesh position={[(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Top piece above opening */}
      <mesh position={[0, openingH + (cliffH-openingH)/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[openingHalfW*2, cliffH-openingH, frontT]} />
        <meshStandardMaterial map={topTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Left wall (adjusted to connect properly) */}
      <mesh position={[-cliffW/2 + 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Right wall (adjusted to connect properly) */}
      <mesh position={[cliffW/2 - 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, cliffH/2, frontZ - courtyardDepth - frontT]} castShadow receiveShadow>
        <boxGeometry args={[cliffW, cliffH, 2]} />
        <meshStandardMaterial map={backTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Courtyard floor */}
      <mesh 
        position={[0, 0.01, frontZ - courtyardDepth/2 - frontT/2]} 
        rotation={[-Math.PI/2, 0, 0]} 
        receiveShadow
      >
        <planeGeometry args={[cliffW-4, courtyardDepth-2]} />
        <meshStandardMaterial 
          map={courtyardTexture}
          metalness={0} 
          roughness={1} 
        />
      </mesh>
        </>
      )}
    </group>
  );
}

// Coins component using sprites
function Coins({ coinRate = 60, coinSize = 1.2, flowSpeed = 1.2, onGetCoins, coinImageUrl }: { 
  coinRate: number; 
  coinSize: number; 
  flowSpeed: number; 
  onGetCoins?: () => { position: THREE.Vector3; visible: boolean; mesh: THREE.Sprite | null }[];
  coinImageUrl?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coinTimerRef = useRef(0);
  const maxCoins = 5000;
  const maxExplosionParticles = 1000;
  
  // Load coin texture from current theme
  const [coinTexture, setCoinTexture] = useState<THREE.Texture | null>(null);
  const coinTextureRef = useRef<THREE.Texture | null>(null);
  
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const imageUrl = coinImageUrl || '/waterfall_coin.png';
    
    loader.load(
      imageUrl,
      (texture) => {
        // Configure texture for proper transparency AFTER it loads
        texture.format = THREE.RGBAFormat;
        texture.premultiplyAlpha = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        
        console.log('🪙 Coin texture loaded with transparency:', {
          format: texture.format,
          premultiplyAlpha: texture.premultiplyAlpha,
          size: `${texture.image?.width}x${texture.image?.height}`
        });
        
        coinTextureRef.current = texture;
        setCoinTexture(texture);
      },
      undefined,
      (error) => {
        console.error('Failed to load coin texture:', error);
      }
    );
    
    return () => {
      if (coinTextureRef.current) {
        coinTextureRef.current.dispose();
        coinTextureRef.current = null;
      }
    };
  }, [coinImageUrl]);
  
  const coins = useMemo(() => {
    const coinsArray = [];
    for (let i = 0; i < maxCoins; i++) {
      coinsArray.push({
        position: new THREE.Vector3(0, 20, -6),
        velocity: 0,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * Math.PI * 2,
        scaleJitter: 1 + (Math.random() * 0.4 - 0.2),
        visible: false,
        mesh: null as THREE.Sprite | null
      });
    }
    return coinsArray;
  }, []);

  // Explosion particles
  const explosionParticles = useMemo(() => {
    const particles = [];
    for (let i = 0; i < maxExplosionParticles; i++) {
      particles.push({
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        velocityY: 0, // Falling velocity
        rotation: 0,
        rotSpeed: 0,
        opacity: 0,
        scale: 0,
        active: false,
        mesh: null as THREE.Sprite | null
      });
    }
    return particles;
  }, []);

  const spawnCoin = useCallback(() => {
    const coinIndex = coins.findIndex(c => !c.visible);
    if (coinIndex !== -1) {
      const coin = coins[coinIndex];
      
      coin.visible = true;
      coin.position.set(
        (Math.random() - 0.5) * 4,
        20,
        -6 + (Math.random() - 0.5) * 0.6
      );
      coin.velocity = 0;
      coin.rotation = Math.random() * Math.PI * 2;
      coin.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 2;
      
      if (coin.mesh) {
        coin.mesh.visible = true;
        coin.mesh.position.copy(coin.position);
      }
    }
  }, [coins]);

  // Create explosion effect
  const createExplosion = useCallback((position: THREE.Vector3, fallingVelocity: number) => {
    const particleCount = 16;
    let spawned = 0;
    
    for (let i = 0; i < explosionParticles.length && spawned < particleCount; i++) {
      const particle = explosionParticles[i];
      if (!particle.active) {
        // Random direction in 3D space
        const angle = (Math.PI * 2 * spawned) / particleCount;
        const elevation = (Math.random() - 0.5) * Math.PI * 0.5;
        const speed = (2 + Math.random() * 3) * 3; // 3x farther
        
        particle.active = true;
        particle.position.copy(position);
        particle.velocity.set(
          Math.cos(angle) * Math.cos(elevation) * speed,
          Math.sin(elevation) * speed,
          Math.sin(angle) * Math.cos(elevation) * speed
        );
        particle.velocityY = fallingVelocity; // Inherit falling velocity
        particle.rotation = Math.random() * Math.PI * 2;
        particle.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 4;
        particle.opacity = 1;
        particle.scale = coinSize * 0.4; // Smaller than original coin
        
        if (particle.mesh) {
          particle.mesh.visible = true;
          particle.mesh.position.copy(particle.position);
          particle.mesh.scale.set(particle.scale, particle.scale, 1);
          particle.mesh.material.opacity = particle.opacity;
        }
        
        spawned++;
      }
    }
  }, [explosionParticles, coinSize]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const interval = 1 / coinRate;
    coinTimerRef.current += delta;
    
    if (coinTimerRef.current >= interval) {
      spawnCoin();
      coinTimerRef.current = 0;
    }

    const gravity = 9.8 * flowSpeed;
    
    // Update coin physics
    coins.forEach((coin) => {
      if (!coin.mesh || !coin.visible) return;
      
      coin.velocity += gravity * delta;
      coin.position.y -= coin.velocity * delta;
      coin.rotation += coin.rotSpeed * delta;
      
      coin.mesh.position.copy(coin.position);
      coin.mesh.material.rotation = coin.rotation;
      
      if (coin.position.y <= 0.2) {
        coin.visible = false;
        coin.mesh.visible = false;
      }
    });

    // Update explosion particles
    explosionParticles.forEach((particle) => {
      if (!particle.active || !particle.mesh) return;
      
      // Apply outward velocity
      particle.position.add(particle.velocity.clone().multiplyScalar(delta));
      
      // Apply gravity (continue falling)
      particle.velocityY += gravity * delta;
      particle.position.y -= particle.velocityY * delta;
      
      // Rotate
      particle.rotation += particle.rotSpeed * delta;
      
      // Fade out
      particle.opacity -= delta * 1.5; // Fade over ~0.66 seconds
      
      // Update mesh
      particle.mesh.position.copy(particle.position);
      particle.mesh.material.rotation = particle.rotation;
      particle.mesh.material.opacity = Math.max(0, particle.opacity);
      
      // Deactivate when fully faded or hit ground
      if (particle.opacity <= 0 || particle.position.y <= 0) {
        particle.active = false;
        particle.mesh.visible = false;
      }
    });
  });

  // Expose coins and explosion function for bullet collision detection
  useEffect(() => {
    if (onGetCoins) {
      (window as any).getCoins = () => coins;
      (window as any).createCoinExplosion = createExplosion;
    }
  }, [coins, onGetCoins, createExplosion]);

  return (
    <group ref={groupRef}>
      {coins.map((coin, index) => (
        <sprite 
          key={index}
          ref={(ref) => { coin.mesh = ref; }}
          visible={false}
          scale={[coinSize * coin.scaleJitter, coinSize * coin.scaleJitter, 1]}
        >
          <spriteMaterial 
            map={coinTexture} 
            transparent 
            alphaTest={0.5}
          />
        </sprite>
      ))}
      {explosionParticles.map((particle, index) => (
        <sprite 
          key={`particle-${index}`}
          ref={(ref) => { particle.mesh = ref; }}
          visible={false}
          scale={[0.5, 0.5, 1]}
        >
          <spriteMaterial 
            map={coinTexture} 
            transparent 
            alphaTest={0.5}
          />
        </sprite>
      ))}
    </group>
  );
}

// Bullets component with collision detection and audio
function Bullets({ bullets }: { 
  bullets: Array<{ 
    position: THREE.Vector3; 
    direction: THREE.Vector3; 
    speed: number; 
    life: number; 
  }>; 
}) {
  return (
    <group>
      {bullets.map((bullet, index) => (
        <mesh key={index} position={[bullet.position.x, bullet.position.y, bullet.position.z]}>
          <sphereGeometry args={[0.05]} />
          <meshBasicMaterial color="#ffff00" />
        </mesh>
      ))}
    </group>
  );
}

// Dynamic lighting component - now reads from shared cycleStateRef
function DynamicLighting({ cycleStateRef }: { 
  cycleStateRef: React.MutableRefObject<{ lightingPercentage: number; cyclePosition: number; isNight: boolean }>;
}) {
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  
  // Cache previous lighting value to avoid unnecessary updates
  const prevLightingRef = useRef(0);
  
  useFrame(() => {
    // Only update if lighting changed significantly (>1% change)
    const currentLighting = cycleStateRef.current.lightingPercentage;
    if (Math.abs(currentLighting - prevLightingRef.current) < 1) {
      return;
    }
    prevLightingRef.current = currentLighting;
    
    // Ensure minimum 5% ambient light so nothing turns pure black
    const baseIntensity = Math.max(0.05, currentLighting / 100);
    
    if (hemisphereRef.current) {
      hemisphereRef.current.intensity = 1.1 * baseIntensity;
    }
    if (directionalRef.current) {
      directionalRef.current.intensity = 1.0 * baseIntensity;
    }
    if (ambientRef.current) {
      ambientRef.current.intensity = 0.25 * baseIntensity;
    }
  });
  
  return (
    <>
      <hemisphereLight 
        ref={hemisphereRef}
        args={['#ffffff', '#edfff6', 1.1]} 
      />
      <directionalLight
        ref={directionalRef}
        position={[35, 45, 15]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <ambientLight 
        ref={ambientRef}
        intensity={0.25} 
      />
    </>
  );
}

// Scene component with audio management and performance optimization
function Scene({ 
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
  setHoveredBlockId
}: {
  settings: { flowSpeed: number; msBetweeenDrops: number; coinRate: number; coinSize: number; colorPalette: any };
  onCoinHit: (position: THREE.Vector3) => void;
  coinImageUrl?: string;
  wallPositions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>;
  blockPlacementMode: boolean;
  onBlockPlace: (position: THREE.Vector3) => void;
  onModeChange: (mode: 'shooting' | 'building' | null) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'inventory' | 'store') => void;
  crosshairsEnabled: boolean;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  blocks: PlacedBlock[];
  weatherSettings: {
    lightingRange: [number, number];
    cycleDuration: number;
  };
  onBlockRain: () => void;
  userRoles: string[];
  isMoveMode: boolean;
  onBlockRemove?: (blockId: string) => Promise<void>;
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId: string | null;
  setHoveredBlockId: (id: string | null) => void;
}) {
  // Create shared cycleStateRef for weather/sky/lighting
  const cycleStateRef = useRef({
    lightingPercentage: weatherSettings.lightingRange[0],
    cyclePosition: 0,
    isNight: false
  });
  // Performance-optimized bullet system with object pooling
  const MAX_BULLETS = 20; // Limit bullets to prevent memory issues
  const [bullets, setBullets] = useState<Array<{ position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number }>>([]);
  const [showCrosshairs, setShowCrosshairs] = useState(false);
  
  // Audio throttling to prevent rapid-fire audio issues
  const lastAudioTime = useRef(0);
  const AUDIO_THROTTLE = 100; // Minimum 100ms between audio plays
  
  // Get camera ref for block rain
  const { camera, scene } = useThree();

  // Unified raycasting system
  const { raycastMeshes } = useRaycaster();
  
  // Store references to all instanced meshes for raycasting
  const instancedMeshesRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  
  // Cache for raycasting optimization - avoid creating arrays every frame
  const meshesArrayCache = useRef<THREE.InstancedMesh[]>([]);
  const meshToBlockTypeCache = useRef<Map<THREE.InstancedMesh, string>>(new Map());
  const blocksByTypeAndUser = useRef<Map<string, PlacedBlock[]>>(new Map());
  
  // Callback to collect mesh refs from PlacedBlocks
  const handleMeshReady = useCallback((blockType: string, mesh: THREE.InstancedMesh | null) => {
    if (mesh) {
      instancedMeshesRef.current.set(blockType, mesh);
      // Update caches
      meshToBlockTypeCache.current.set(mesh, blockType);
      meshesArrayCache.current = Array.from(instancedMeshesRef.current.values());
    } else {
      instancedMeshesRef.current.delete(blockType);
    }
  }, []);

  // Dynamic fog based on visual distance and user preference
  const { visualDistance, fogEnabled } = useBlocks();

  // Multiplayer - track and display other players
  const { players, broadcastPosition, isConnected } = useMultiplayer('fortress-main');
  
  // Use showOwnershipOutline from props
  const { user } = useAuth();
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.repeat) {
        e.preventDefault();
        // Toggle is now handled in parent component, just prevent default here
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [blockPlacementMode]);
  
  // Multiplayer connection status
  useEffect(() => {
    if (isConnected) {
      // Connected
    }
  }, [isConnected, players.size]);

  useEffect(() => {
    if (fogEnabled) {
      // Fog starts at 75% of visual distance, fully grey at 100%
      const fogStart = (visualDistance * 0.75) * CHUNK_SIZE;
      const fogEnd = visualDistance * CHUNK_SIZE;
      
      scene.fog = new THREE.Fog(
        0xcccccc,  // Light grey fog color
        fogStart,   // Fog begins to appear
        fogEnd      // Fully fog color
      );
      
      // Force all materials to update their fog uniforms
      scene.traverse((object) => {
        if ((object as any).isMesh) {
          const mesh = object as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if ((mat as any).isMaterial) {
                mat.needsUpdate = true;
              }
            });
          }
        }
      });
    } else {
      scene.fog = null;
      console.log('🌫️ Fog disabled');
      
      // Force materials to update when fog is disabled
      scene.traverse((object) => {
        if ((object as any).isMesh) {
          const mesh = object as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if ((mat as any).isMaterial) {
                mat.needsUpdate = true;
              }
            });
          }
        }
      });
    }
    
    return () => {
      scene.fog = null;
    };
  }, [scene, visualDistance, fogEnabled]);

  // Single audio context and optimized audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRefs = useRef({
    pistolCocking: new Audio('/pistol_cocking_sound.mp3'),
    pistolHolster: new Audio('/holster_pistol_sound.mp3'),
    gunshot: new Audio('/space_gunshot.mp3'),
    coinHit: new Audio('/coin_hit_sound.mp3'),
    woodenThud: new Audio('/wooden_thud_sound.mp3')
  });

  // Block Rain handler - triggered by custom event
  useEffect(() => {
    const handleBlockRainEvent = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { blockTypes, batchHandler, settings } = customEvent.detail;
      
      console.log('Block rain event received in Scene component', settings);
      
      // Raycast from camera to find target point
      const raycaster = new THREE.Raycaster();
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(camera.quaternion);
      raycaster.set(camera.position, direction);
      
      // Create a ground plane for intersection
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const targetPosition = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, targetPosition);
      
      console.log('Target position for block rain:', targetPosition);
      
      // Use settings from admin panel or defaults
      const totalBlocks = settings?.totalBlocks || 100;
      const spreadRadius = settings?.spreadRadius || 5; // Use radius from admin settings
      const blockPositions: Array<{ x: number; y: number; z: number; type: string }> = [];
      
      // Helper function to check if position is in forbidden zone
      const isInForbiddenZone = (x: number, z: number): boolean => {
        const position = new THREE.Vector3(x, 0, z);
        const fortressCenter = new THREE.Vector3(0, 0, -20);
        const fortressMinDistance = 30;
        const waterfallZ = -6;
        const waterfallBlockingWidth = 4;
        
        // Check distance from fortress
        const distanceToFortress = position.distanceTo(fortressCenter);
        if (distanceToFortress < fortressMinDistance) {
          return true;
        }
        
        // Check if blocking waterfall entrance path (infinite forward path)
        if (Math.abs(x) < waterfallBlockingWidth / 2 && z > waterfallZ) {
          return true;
        }
        
        return false;
      };
      
      // Create positions for specified number of blocks
      for (let i = 0; i < totalBlocks; i++) {
        const randomBlockType = blockTypes[Math.floor(Math.random() * blockTypes.length)];
        
        // Random position within spread radius
        const randomX = targetPosition.x + (Math.random() - 0.5) * spreadRadius * 2;
        const randomZ = targetPosition.z + (Math.random() - 0.5) * spreadRadius * 2;
        
        // Round to grid
        const gridX = Math.round(randomX);
        const gridZ = Math.round(randomZ);
        
        // Find the highest existing block at this X,Z position for stacking
        // Use height map for O(1) lookup instead of iterating all blocks
        const key = `${gridX},${gridZ}`;
        
        // Check height map first (includes landed blocks)
        // heightMap already stores the Y where NEXT block should land (no +1 needed)
        const { heightMap, fallingBlocksState } = await import('./PlacedBlocks');
        const groundY = heightMap.get(key) || 0;
        
        blockPositions.push({
          x: gridX,
          y: groundY,
          z: gridZ,
          type: randomBlockType
        });
      }
      
      console.log('Calculated', blockPositions.length, 'block positions');
      
      // Use batch handler for instant placement
      if (batchHandler) {
        await batchHandler(blockPositions, settings);
      }
    };
    
    window.addEventListener('triggerBlockRain', handleBlockRainEvent);
    
    return () => {
      window.removeEventListener('triggerBlockRain', handleBlockRainEvent);
    };
  }, [camera, blocks]);
  
  // Initialize audio context and preload sounds (optimized)
  useEffect(() => {
    // Create single audio context only if it doesn't exist
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('AudioContext created');
      }
    } catch (e) {
      console.warn('Web Audio API not supported');
    }

    // Optimize audio settings for performance
    const audioElements = audioRefs.current;
    Object.values(audioElements).forEach(audio => {
      audio.volume = audio === audioElements.gunshot ? 0.2 : 0.4; // Lower gunshot volume
      audio.preload = 'auto';
      audio.load();
    });

    return () => {
      // Cleanup audio context only if it exists and isn't already closed
      if (audioContextRef.current) {
        const ctx = audioContextRef.current;
        if (ctx.state !== 'closed') {
          console.log('Closing AudioContext');
          ctx.close().catch(err => {
            // Ignore errors if already closing
            if (err.name !== 'InvalidStateError') {
              console.error('Error closing AudioContext:', err);
            }
          });
        }
        audioContextRef.current = null; // Clear ref to prevent double close
      }
    };
  }, []);

  // Throttled audio play function to prevent audio spam
  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    const now = Date.now();
    if (now - lastAudioTime.current < AUDIO_THROTTLE) {
      return; // Throttle rapid audio plays
    }
    
    try {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      // Reset and play audio
      if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
        audio.currentTime = 0;
        await audio.play();
        lastAudioTime.current = now;
      }
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }, []);

  // Performance-optimized bullet creation with object pooling
  const handleShoot = useCallback((origin: THREE.Vector3, direction: THREE.Vector3) => {
    setBullets(prev => {
      // Limit bullets to prevent memory issues
      const newBullets = prev.slice(-MAX_BULLETS + 1);
      
      // Reuse Vector3 objects when possible
      const bulletPos = new THREE.Vector3().copy(origin);
      const bulletDir = new THREE.Vector3().copy(direction);
      
      newBullets.push({
        position: bulletPos,
        direction: bulletDir,
        speed: 100,
        life: 3.0
      });
      
      return newBullets;
    });
    setShowCrosshairs(true);
  }, []);

  // Optimized frame loop with reduced garbage collection and throttling
  const frameCount = useRef(0);
  useFrame((state, delta) => {
    // Throttle expensive operations to every few frames
    frameCount.current++;
    
    // Only process bullets every frame, but throttle other operations
    setBullets(prev => {
      if (prev.length === 0) return prev;
      
      const activeBullets = [];
      const coins = (window as any).getCoins ? (window as any).getCoins() : [];
      
      for (let i = 0; i < prev.length; i++) {
        const bullet = prev[i];
        
        // Update position (reuse existing Vector3)
        bullet.position.addScaledVector(bullet.direction, bullet.speed * delta);
        bullet.life -= delta;
        
        if (bullet.life > 0) {
          // Efficient collision detection
          let hit = false;
          
          for (let j = 0; j < coins.length && !hit; j++) {
            const coin = coins[j];
            if (coin.visible && coin.mesh) {
              const distance = bullet.position.distanceTo(coin.position);
              if (distance < 0.8) {
                // Create explosion effect
                if ((window as any).createCoinExplosion) {
                  (window as any).createCoinExplosion(coin.position.clone(), coin.velocity);
                }
                
                coin.visible = false;
                if (coin.mesh) coin.mesh.visible = false;
                onCoinHit(coin.position);
                
                // Throttled audio play
                playAudio(audioRefs.current.coinHit);
                hit = true;
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
      
      {/* Multiplayer - render other players */}
      <MultiplayerPlayers players={players} />
      
      {/* Local player avatar - visible only in shadows and reflections */}
      <LocalPlayerAvatar />
      
      {/* Dynamic Lighting with weather cycle */}
      <DynamicLighting cycleStateRef={cycleStateRef} />

      {/* Dynamic Sky with day/night cycle and stars */}
      <DynamicSky weatherSettings={weatherSettings} cycleStateRef={cycleStateRef} />

      {/* Scene objects */}
      <Fortress />
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
      
      {/* FPS Counter */}
      <FPSCounter />
    </>
  );
}

// Collapsible control panel component
function ControlPanel({ settings, onSettingsChange, isVisible }: { 
  settings: any; 
  onSettingsChange: (key: string, value: any) => void;
  isVisible: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Reset collapsed state when panel becomes visible
  useEffect(() => {
    if (isVisible) {
      setIsCollapsed(false);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-4 z-20 w-[28rem]">
      <Card className="waterfall-card w-full">
        <div 
          className="flex items-center justify-between mb-3 cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <h3 className="font-bold text-sm">WATERFALL & COINS</h3>
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
        
        {!isCollapsed && (
          <div className="space-y-3 animate-fade-in">
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Flow speed</Label>
              <Slider
                value={[settings.flowSpeed]}
                onValueChange={([value]) => onSettingsChange('flowSpeed', value)}
                min={0.2}
                max={3}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.flowSpeed.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">MS between drops</Label>
              <Slider
                value={[settings.msBetweeenDrops]}
                onValueChange={([value]) => onSettingsChange('msBetweeenDrops', value)}
                min={0.1}
                max={5}
                step={0.1}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.msBetweeenDrops.toFixed(1)}ms</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin rate (ps)</Label>
              <Slider
                value={[settings.coinRate]}
                onValueChange={([value]) => onSettingsChange('coinRate', value)}
                min={0}
                max={10}
                step={1}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinRate}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin size</Label>
              <Slider
                value={[settings.coinSize]}
                onValueChange={([value]) => onSettingsChange('coinSize', value)}
                min={0.2}
                max={1}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinSize.toFixed(2)}</span>
            </div>
            
            {/* Color/Weight Controls */}
            <div className="mt-4 space-y-2">
              <Label className="text-xs opacity-85 font-semibold">Drop Colors & Weights</Label>
              <div className="grid grid-cols-3 gap-2">
                {settings.colorPalette.map((colorWeight, index) => (
                  <div key={index} className="flex items-center gap-1 text-xs">
                    <div 
                      className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: colorWeight.hex }}
                    />
                    <Input
                      type="color"
                      value={colorWeight.hex}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], hex: e.target.value };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-6 h-6 p-0 border-0 cursor-pointer flex-shrink-0"
                    />
                    <Input
                      type="number"
                      value={colorWeight.weight}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], weight: parseInt(e.target.value) || 0 };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-12 h-6 text-xs p-1 flex-1"
                      min="0"
                      max="100"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 text-xs opacity-75">
              Click to lock mouse • WASD move • Shift run • Space jump • Ctrl crawl • ESC unlock
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// Main Waterfall Fortress component
export default function WaterfallFortress() {
  // Default color/weight pairs - 6 colors as requested
  const { currentTheme, isLoading: themeLoading } = useTokenTheme();
  
  const defaultColorPalette = [
    { hex: '#06c8c0', weight: 10 },
    { hex: '#028eef', weight: 10 },
    { hex: '#194ca8', weight: 20 },
    { hex: '#18488a', weight: 30 },
    { hex: '#103d6a', weight: 30 },
    { hex: '#0a2847', weight: 15 }
  ];

  const [settings, setSettings] = useState({
    flowSpeed: 1.2,
    msBetweeenDrops: 1,
    coinRate: 6,
    coinSize: 0.8,
    colorPalette: defaultColorPalette
  });
  
  // Load settings from current theme
  useEffect(() => {
    if (currentTheme && !themeLoading) {
      console.log('Loading theme settings:', currentTheme.display_name);
      setSettings({
        flowSpeed: currentTheme.flow_speed,
        msBetweeenDrops: currentTheme.ms_between_drops,
        coinRate: currentTheme.coin_rate,
        coinSize: currentTheme.coin_size,
        colorPalette: currentTheme.color_palette
      });
    }
  }, [currentTheme, themeLoading]);
  
  // Weather settings state
  const [weatherSettings, setWeatherSettings] = useState(() => {
    const stored = localStorage.getItem('weatherSettings');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate old format to new format
      if ('maxLighting' in parsed && 'minLighting' in parsed) {
        return {
          lightingRange: [parsed.minLighting, parsed.maxLighting] as [number, number],
          cycleDuration: parsed.cycleDuration || 5
        };
      }
      return parsed;
    }
    return {
      lightingRange: [0, 100] as [number, number],
      cycleDuration: 2 // minutes - smooth visible cycle
    };
  });
  
  const [panelsVisible, setPanelsVisible] = useState(false);
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState<string | null>(null);
  const [blockPlacementMode, setBlockPlacementMode] = useState<boolean>(false);
  const [showOwnershipOutline, setShowOwnershipOutline] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  
  // Wall positions state for real-time control
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  const [isMoveMode, setIsMoveMode] = useState(false);
  
  // User data and block system hooks
  const { profile, tokenBalance, inventory, userRoles, addCoins, useBlock, refreshData } = useUserData();
  const { blocks, placeBlock, removeBlock, setBlockMode } = useBlocks();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isOpen: panelOpen, openPanel } = useUserPanel();
  const { openPanel: openAdminPanel } = useAdminPanel();
  
  // Handle block removal with Caps Lock
  const handleBlockRemove = useCallback(async (blockId: string) => {
    // Play reversed wooden thud sound
    if (mainAudioRefs.current.woodenThud) {
      const audio = mainAudioRefs.current.woodenThud;
      audio.playbackRate = -1; // Attempt to reverse (may not work in all browsers)
      audio.currentTime = audio.duration || 0;
      audio.play().catch(() => {});
      
      // Fallback: play normally but reversed via Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      fetch('/wooden_thud_sound.mp3')
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
        .then(audioBuffer => {
          // Reverse the audio buffer
          const reversedBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            audioBuffer.length,
            audioBuffer.sampleRate
          );
          
          for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const inputData = audioBuffer.getChannelData(channel);
            const outputData = reversedBuffer.getChannelData(channel);
            for (let i = 0; i < audioBuffer.length; i++) {
              outputData[i] = inputData[audioBuffer.length - 1 - i];
            }
          }
          
          const source = audioContext.createBufferSource();
          source.buffer = reversedBuffer;
          source.connect(audioContext.destination);
          source.start(0);
        })
        .catch(error => console.warn('Failed to play reversed sound:', error));
    }
    
    const success = await removeBlock(blockId);
    if (success) {
      toast({
        title: "Block removed",
        description: "Block returned to inventory",
        duration: 2000
      });
    }
  }, [removeBlock, toast]);
  
  
  // Main component audio refs for placement sounds
  const mainAudioRefs = useRef({
    woodenThud: new Audio('/wooden_thud_sound.mp3')
  });
  
  // Initialize main audio
  useEffect(() => {
    mainAudioRefs.current.woodenThud.preload = 'auto';
    mainAudioRefs.current.woodenThud.load();
  }, []);

  const handleSettingsChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };
  
  const handleWeatherSettingsChange = (key: string, value: number | [number, number]) => {
    setWeatherSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('weatherSettings', JSON.stringify(newSettings));
      return newSettings;
    });
  };

  // Flying coin animation state
  const [flyingCoins, setFlyingCoins] = useState<Array<{
    id: string;
    startX: number;
    startY: number;
    startTime: number;
  }>>([]);

  const handleCoinHit = useCallback(async (position: THREE.Vector3, screenPosition?: { x: number; y: number }) => {
    // Create flying coin animation
    const coinId = Math.random().toString(36).substr(2, 9);
    const startTime = Date.now();
    
    // Convert 3D position to screen position if not provided
    let startX = screenPosition?.x || window.innerWidth / 2;
    let startY = screenPosition?.y || window.innerHeight / 2;
    
    // Add flying coin to state
    setFlyingCoins(prev => [...prev, {
      id: coinId,
      startX,
      startY,
      startTime
    }]);

    // Play coin hit sound
    const audio = new Audio('/coin_hit_sound.mp3');
    audio.volume = 0.3;
    audio.play();

    // Remove flying coin after animation and add to database
    setTimeout(async () => {
      const success = await addCoins(1);
      if (success) {
        setCoinScore(prev => prev + 1);
      }
      
      // Remove this flying coin from state
      setFlyingCoins(prev => prev.filter(coin => coin.id !== coinId));
    }, 600); // Animation duration
  }, [addCoins]);

  // Block Rain feature - spawns random blocks at ground level with stacking
  const handleBlockRainBatch = useCallback(async (
    positions: Array<{ x: number; y: number; z: number; type: string }>,
    settings?: { blocksPerSecond?: number; blockLifeMinutes?: number; totalBlocks?: number; spreadRadius?: number }
  ) => {
    if (!placeBlock) return;
    
    console.log('Starting block rain with settings:', settings);
    
    // Helper function to check if position is in forbidden zone
    const isInForbiddenZone = (x: number, z: number): boolean => {
      const position = new THREE.Vector3(x, 0, z);
      const fortressCenter = new THREE.Vector3(0, 0, -20);
      const fortressMinDistance = 30;
      const waterfallZ = -6;
      const waterfallBlockingWidth = 4;
      
      // Check distance from fortress
      const distanceToFortress = position.distanceTo(fortressCenter);
      if (distanceToFortress < fortressMinDistance) {
        return true;
      }
      
      // Check if blocking waterfall entrance path (infinite forward path)
      if (Math.abs(x) < waterfallBlockingWidth / 2 && z > waterfallZ) {
        return true;
      }
      
      return false;
    };
    
    // Use settings from admin panel or defaults
    const blockLifeMinutes = settings?.blockLifeMinutes || 10;
    const blocksPerSecond = settings?.blocksPerSecond || 10;
    const delayBetweenBlocks = Math.max(20, 1000 / blocksPerSecond); // Min 20ms delay, max 50/sec
    
    console.log(`Block rain rate: ${blocksPerSecond}/sec (${delayBetweenBlocks}ms delay)`);
    
    // Set expiration based on admin settings OR immediate expiration for forbidden zones
    let placedCount = 0;
    let lastThudTime = 0;
    const startTime = Date.now();
    
    // Initialize local height map from global heightMap to prevent race conditions
    const { heightMap, fallingBlocksState } = await import('./PlacedBlocks');
    const localHeightMap = new Map<string, number>(heightMap);
    
    // Place blocks with minimal delay - fire database writes without awaiting to achieve high rates
    const placementPromises: Promise<any>[] = [];
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      
      // Delay between each block based on blocks per second setting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBlocks));
      }
      
      const key = `${pos.x},${pos.z}`;
      
      // Get the landing Y from localHeightMap (already includes stacking logic)
      const targetY = localHeightMap.get(key) || 0;
      
      // Check if in forbidden zone - if so, expire immediately
      const inForbiddenZone = isInForbiddenZone(pos.x, pos.z);
      const expiresAt = inForbiddenZone 
        ? new Date(Date.now()).toISOString() // Expire immediately
        : new Date(Date.now() + blockLifeMinutes * 60 * 1000).toISOString();
      
      // Fire off block placement without awaiting (parallel execution)
      const placementPromise = placeBlock(pos.x, targetY, pos.z, pos.type, expiresAt)
        .then(placedBlock => {
          if (placedBlock) {
            // Add to falling blocks state for visual animation (in-memory only)
            fallingBlocksState.set(placedBlock.id, {
              currentY: 100,
              velocity: 0,
              targetY: targetY
            });
            placedCount++;
          }
        })
        .catch(error => {
          console.error('Failed to place block:', error);
        });
      
      placementPromises.push(placementPromise);
      
      // Optimistically update heightMap for next block
      localHeightMap.set(key, targetY + 1);
      
      // Play thud sound (throttled to every 50ms)
      const now = Date.now();
      if (mainAudioRefs.current.woodenThud && now - lastThudTime > 50) {
        mainAudioRefs.current.woodenThud.currentTime = 0;
        mainAudioRefs.current.woodenThud.volume = 0.3;
        mainAudioRefs.current.woodenThud.play().catch(() => {});
        lastThudTime = now;
      }
    }
    
    // Wait for all placements to complete
    await Promise.all(placementPromises);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const actualRate = (placedCount / parseFloat(duration)).toFixed(1);
    
    console.log(`Block rain complete: ${placedCount} blocks in ${duration}s (${actualRate}/sec)`);
    
    toast({
      title: "Block Rain Complete!",
      description: `${placedCount} blocks placed in ${duration}s (${actualRate}/sec, expire in ${blockLifeMinutes} min)`,
      duration: 3000
    });
  }, [toast, placeBlock, blocks]);

  // Block Rain trigger - uses admin settings if available
  const handleBlockRain = useCallback(() => {
    console.log('=== BLOCK RAIN TRIGGERED ===');
    
    // Try to load admin settings from localStorage
    let blockTypes = ['fortress_block', 'grass_block', 'crystal_block'];
    let settings = {
      blocksPerSecond: 10,
      totalBlocks: 100,
      blockLifeMinutes: 10,
      spreadRadius: 5
    };
    
    try {
      const adminSettings = localStorage.getItem('adminBlockRainSettings');
      if (adminSettings) {
        const parsed = JSON.parse(adminSettings);
        if (parsed.selectedBlocks && parsed.selectedBlocks.length > 0) {
          blockTypes = parsed.selectedBlocks;
        }
        settings = {
          blocksPerSecond: parsed.blocksPerSecond || 10,
          totalBlocks: parsed.totalBlocks || 100,
          blockLifeMinutes: parsed.blockLifeMinutes || 10,
          spreadRadius: parsed.spreadRadius || 5
        };
        console.log('Using admin block rain settings:', settings, blockTypes);
      }
    } catch (error) {
      console.error('Failed to load admin block rain settings:', error);
    }
    
    // Trigger block rain in the Scene component via a custom event
    const event = new CustomEvent('triggerBlockRain', {
      detail: { blockTypes, batchHandler: handleBlockRainBatch, settings }
    });
    window.dispatchEvent(event);
    
    toast({
      title: "Block Rain!",
      description: `Spawning ${settings.totalBlocks} random blocks...`,
      duration: 1000
    });
  }, [toast, handleBlockRainBatch]);

  const handleBlockPlace = useCallback(async (position: THREE.Vector3) => {
    console.log('=== BLOCK PLACEMENT START ===');
    console.log('handleBlockPlace called with position:', {
      x: position.x,
      y: position.y,
      z: position.z,
      rounded: {
        x: Math.round(position.x),
        y: Math.round(position.y),
        z: Math.round(position.z)
      }
    });
    console.log('selectedBlockType:', selectedBlockType);
    
    if (!selectedBlockType) {
      console.log('No selectedBlockType');
      return;
    }
    
    // Check if user has blocks in inventory
    const hasBlocks = inventory.some(item => item.item_type === selectedBlockType && item.quantity > 0);
    console.log('Has blocks in inventory:', hasBlocks, 'inventory:', inventory);
    
    if (!hasBlocks) {
      console.log('No blocks in inventory');
      toast({
        title: "No blocks available",
        description: `You don't have any ${selectedBlockType} blocks in your inventory`,
        variant: "destructive"
      });
      return;
    }
    
    // Use block from inventory
    const success = await useBlock(selectedBlockType);
    if (!success) {
      console.log('Failed to use block from inventory');
      return;
    }
    
    // Place block in the world with rounded coordinates for grid alignment
    try {
      const roundedPos = {
        x: Math.round(position.x),
        y: Math.round(position.y), 
        z: Math.round(position.z)
      };
      console.log('Placing block at rounded position:', roundedPos);
      
      const placedBlock = await placeBlock(roundedPos.x, roundedPos.y, roundedPos.z, selectedBlockType);
      if (placedBlock) {
        console.log('Block placed successfully:', placedBlock);
        console.log('Block should appear at:', `(${placedBlock.position_x}, ${placedBlock.position_y}, ${placedBlock.position_z})`);
        
        // Play placement sound
        try {
          mainAudioRefs.current.woodenThud.currentTime = 0;
          await mainAudioRefs.current.woodenThud.play();
        } catch (audioError) {
          console.log('Audio play failed:', audioError);
        }
        
        toast({
          title: "✓ Block placed!",
          description: `${selectedBlockType} placed at (${placedBlock.position_x}, ${placedBlock.position_y}, ${placedBlock.position_z})`,
        });
        
        // Check if we still have blocks (inventory is already updated optimistically)
        const currentItem = inventory.find(item => item.item_type === selectedBlockType);
        const stillHasBlocks = currentItem && currentItem.quantity > 0;
        
        if (!stillHasBlocks) {
          // Find next available block type
          const availableBlocks = inventory.filter(item => item.quantity > 0 && item.item_type !== selectedBlockType);
          console.log('No more blocks of type', selectedBlockType, 'available blocks:', availableBlocks);
          
          if (availableBlocks.length > 0) {
            const nextBlock = availableBlocks[0];
            setSelectedBlockType(nextBlock.item_type);
            toast({
              title: "Auto-switched block type",
              description: `Switched to ${nextBlock.item_type} (${nextBlock.quantity} available)`,
              duration: 2000
            });
          } else {
            // No blocks available, exit block mode
            handleModeChange(null);
            toast({
              title: "No more blocks",
              description: "All blocks used! Purchase more from the shop.",
              duration: 3000
            });
          }
        }
      } else {
        console.log('placeBlock returned null/undefined');
      }
    } catch (error) {
      console.error('Failed to place block:', error);
      toast({
        title: "Block placement failed",
        description: "There was an error placing the block",
        variant: "destructive"
      });
    }
  }, [selectedBlockType, inventory, useBlock, placeBlock, toast]);

  const handleBlockPurchased = useCallback(async () => {
    // Refresh user data to update inventory and coin count
    console.log('Block purchased, refreshing data...');
    await refreshData();
    console.log('Data refreshed after purchase');
  }, [refreshData]);

  const getBlockQuantity = (itemType: string) => {
    const item = inventory.find(i => i.item_type === itemType);
    return item?.quantity || 0;
  };

  // Mode change handler
  const handleModeChange = useCallback((mode: 'shooting' | 'building' | null) => {
    console.log('Mode change requested:', mode);
    const availableItems = inventory.filter(item => item.quantity > 0);
    console.log('Available inventory items:', availableItems.map(item => `${item.item_type}:${item.quantity}`));
    
    if (mode === 'building') {
      // Find first available block type from inventory
      const availableItem = availableItems[0];
      if (availableItem) {
        console.log('Setting block mode with available block:', availableItem.item_type, 'quantity:', availableItem.quantity);
        setSelectedBlockType(availableItem.item_type);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true);
        setBlockMode(true); // Enable periodic syncing
        
        toast({
          title: "Block mode enabled",
          description: `Press left click to place ${availableItem.item_type}. Press B to exit.`,
          duration: 3000
        });
      } else {
        console.log('Entering block mode with no blocks available in inventory:', inventory);
        setSelectedBlockType(null);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true); // Enable block mode even without blocks
        setBlockMode(true); // Enable periodic syncing
        
        toast({
          title: "You don't have any blocks to place",
          description: "Press letter O to Open the Shop and purchase blocks",
          duration: 4000
        });
      }
    } else if (mode === 'shooting') {
      console.log('Setting shooting mode');
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setCrosshairsEnabled(true);
      setBlockMode(false); // Disable periodic syncing
    } else {
      console.log('Setting null mode (exit block mode)');
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setCrosshairsEnabled(false);
      setBlockMode(false); // Disable periodic syncing
      
      if (mode === null) {
        toast({
          title: "Block mode disabled",
          description: "Press B to re-enter block placement mode",
          duration: 2000
        });
      }
    }
  }, [inventory, setBlockMode, toast]);

  // Cycle through available blocks with mouse wheel
  const cycleSelectedBlock = useCallback((direction: 'next' | 'prev') => {
    const availableBlocks = inventory.filter(item => item.quantity > 0);
    if (availableBlocks.length === 0) return;
    
    // If no block is selected, select the first one
    if (!selectedBlockType) {
      const firstBlock = availableBlocks[0];
      setSelectedBlockType(firstBlock.item_type);
      toast({
        title: "Block selected",
        description: `Selected ${firstBlock.item_type} (${firstBlock.quantity} available)`,
        duration: 1000
      });
      return;
    }
    
    if (availableBlocks.length <= 1) return;
    
    const currentIndex = availableBlocks.findIndex(item => item.item_type === selectedBlockType);
    if (currentIndex === -1) {
      // Current block not found, select the first available
      const firstBlock = availableBlocks[0];
      setSelectedBlockType(firstBlock.item_type);
      toast({
        title: "Block selected", 
        description: `Selected ${firstBlock.item_type} (${firstBlock.quantity} available)`,
        duration: 1000
      });
      return;
    }
    
    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % availableBlocks.length;
    } else {
      nextIndex = (currentIndex - 1 + availableBlocks.length) % availableBlocks.length;
    }
    
    const nextBlock = availableBlocks[nextIndex];
    setSelectedBlockType(nextBlock.item_type);
    
    toast({
      title: "Block selected",
      description: `Selected ${nextBlock.item_type} (${nextBlock.quantity} available)`,
      duration: 1000
    });
  }, [selectedBlockType, inventory, toast]);

  // Panel handler
  const handleOpenPanel = useCallback((tab: 'user' | 'wallet' | 'inventory' | 'store') => {
    openPanel(tab);
  }, [openPanel]);

  // Listen for crosshair state changes from FirstPersonControls
  useEffect(() => {
    const handleCrosshairChange = (event: CustomEvent) => {
      setCrosshairsEnabled(event.detail.enabled);
    };

    window.addEventListener('crosshairChange', handleCrosshairChange as EventListener);
    return () => {
      window.removeEventListener('crosshairChange', handleCrosshairChange as EventListener);
    };
  }, []);

  // Toggle performance monitor with Command/Ctrl + P and ownership outline with Tab
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Command (Mac) or Ctrl (Windows/Linux) + P
      if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
        event.preventDefault(); // Prevent default print dialog
        setShowPerfMonitor(prev => !prev);
      }
      
      // Toggle ownership outline with Tab when in block mode
      if (event.key === 'Tab' && blockPlacementMode) {
        event.preventDefault();
        setShowOwnershipOutline(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [blockPlacementMode]);

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
      {showPerfMonitor && <Perf position="top-left" minimal={false} />}
      <Scene
        settings={settings}
        onCoinHit={handleCoinHit} 
        wallPositions={wallPositions}
        blockPlacementMode={blockPlacementMode}
        onBlockPlace={handleBlockPlace}
        onModeChange={handleModeChange}
        onOpenPanel={handleOpenPanel}
        crosshairsEnabled={crosshairsEnabled}
        getBlockQuantity={getBlockQuantity}
        coinImageUrl={currentTheme?.coin_image_url}
        selectedBlockType={selectedBlockType}
        panelOpen={panelOpen}
        onCycleBlock={cycleSelectedBlock}
        blocks={blocks}
        weatherSettings={weatherSettings}
        onBlockRain={handleBlockRain}
        userRoles={userRoles}
        isMoveMode={isMoveMode}
        onBlockRemove={handleBlockRemove}
        showOwnershipOutline={showOwnershipOutline}
        currentUserId={user?.id}
        hoveredBlockId={hoveredBlockId}
        setHoveredBlockId={setHoveredBlockId}
      />
      
      {/* Block Preview */}
      {selectedBlockType && (
        <BlockPreview 
          blockType={selectedBlockType}
          visible={true}
          existingBlocks={blocks || []}
        />
      )}
    </Canvas>

    {/* Flying coin animations */}
    {flyingCoins.map(coin => (
      <div
        key={coin.id}
        className="fixed pointer-events-none z-50"
        style={{
          left: coin.startX,
          top: coin.startY,
          animation: 'flyToCoin 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
        }}
      >
        <img 
          src="/waterfall_coin.png" 
          alt="coin" 
          className="w-8 h-8 animate-spin"
        />
      </div>
    ))}

    {/* FPS Display */}
    <FPSDisplay />

    {/* Top right controls */}
    <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
      {/* User email display */}
      {user?.email && (
        <div className="bg-black/70 text-white px-3 py-2 rounded text-sm font-medium border border-white/20">
          {user.email}
        </div>
      )}
      
      {/* Sign out button */}
      <Button
        className="waterfall-button bg-red-500/80 hover:bg-red-600/80 text-white border-red-400/50"
        size="sm"
        onClick={signOut}
        title="Sign out"
      >
        Sign Out
      </Button>
      
      {/* Admin Panel toggle - Only visible for admin/superadmin */}
      {(userRoles.includes('admin') || userRoles.includes('superadmin')) && (
        <Button
          className="waterfall-button"
          size="sm"
          onClick={() => openAdminPanel('coins')}
          title="Admin Panel"
        >
          <Eye className="h-4 w-4" />
        </Button>
      )}
    </div>
    
    {/* Admin Panel (replaces inline control panels) */}
    <AdminPanel 
      waterfallSettings={settings}
      onWaterfallSettingsChange={handleSettingsChange}
      onWallPositionsChange={setWallPositions}
      onMoveModeChange={setIsMoveMode}
      weatherSettings={weatherSettings}
      onWeatherSettingsChange={handleWeatherSettingsChange}
    />
    
    {/* Score display and block inventory */}
    <div className="fixed bottom-4 left-4 z-20 flex items-center gap-2">
      {/* Coin display with separated click areas */}
      <div className="flex items-center gap-0 bg-black/50 text-white rounded">
        {/* Shooting mode button area (around coin icon) */}
        <div 
          className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-l"
          onClick={() => openPanel('inventory')}
          title="Open inventory"
        >
          <img src={currentTheme?.coin_image_url || '/waterfall_coin.png'} alt="coin" className="w-6 h-6" />
        </div>
        {/* Coin count (clickable to open inventory) */}
        <div 
          className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-r border-l border-white/20"
          onClick={() => openPanel('inventory')}
          title="Open inventory"
        >
          <span className="font-bold">x{tokenBalance?.coins || 0}</span>
        </div>
      </div>
      
      {/* Block inventory */}
      <div className="flex items-center gap-2">
        {/* Block inventory - Only show total of blocks with quantity > 0 */}
        <div 
          className={`flex items-center gap-2 bg-black/50 text-white p-2 rounded cursor-pointer transition-colors ${
            blockPlacementMode ? 'bg-blue-500/70' : 'hover:bg-black/70'
          }`}
          onClick={() => {
            const availableBlocks = inventory.filter(item => item.quantity > 0);
            const totalBlocks = availableBlocks.reduce((total, item) => total + item.quantity, 0);
            console.log('Block inventory clicked:', { availableBlocks, totalBlocks, selectedBlockType });
            
            if (totalBlocks > 0) {
              handleModeChange(selectedBlockType ? null : 'building');
            } else {
              openPanel('store');
            }
          }}
          title={(() => {
            const availableBlocks = inventory.filter(item => item.quantity > 0);
            const totalBlocks = availableBlocks.reduce((total, item) => total + item.quantity, 0);
            return totalBlocks > 0 ? 
              (selectedBlockType ? "Exit block mode" : "Enter block mode") : 
              "Buy blocks from shop";
          })()}
        >
          <div className="w-6 h-6 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center">
            <div className="w-4 h-4 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
          </div>
          <span className="font-bold">x{inventory.filter(item => item.quantity > 0).reduce((total, item) => total + item.quantity, 0)}</span>
        </div>
        
        {/* Block mode indicator */}
        {blockPlacementMode && selectedBlockType && (
          <div className="bg-blue-500/70 text-white px-2 py-1 rounded text-xs">
            BLOCK MODE: {selectedBlockType}
          </div>
        )}
      </div>
    </div>
    
    {/* Instructions */}
    <div className="fixed bottom-4 right-4 z-20 text-white text-sm bg-black/50 p-2 rounded">
      <div>{blockPlacementMode ? (selectedBlockType ? 'Click to place block • Tab to see placed blocks' : 'Tab to see placed blocks • O to buy blocks') : 'R for crosshairs • Click to shoot'}</div>
      <div className="text-xs opacity-75 mt-1">
        B = Block mode • O = Open Shop • I = Inventory
      </div>
    </div>
    
    {/* User Panel (replaces BlockShop and Inventory) */}
    <UserPanel onBlockPurchased={handleBlockPurchased} />
    
    {/* Crosshair - conditional class for different modes */}
    <div className={`waterfall-crosshair ${
      blockPlacementMode ? 'block-mode' : 
      crosshairsEnabled ? 'active' : ''
    }`} />
    
    {/* Toast notifications */}
    <Toaster />
    </div>
  );
}