import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
import { UserPanel } from '@/components/UserPanel';
import { AdminPanel } from '@/components/AdminPanel';
import { useUserData } from '@/hooks/useUserData';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useToast } from '@/hooks/use-toast';
import { PlacedBlock } from '@/types/blocks';
import { Toaster } from '@/components/ui/toaster';
import { calculateBlockPlacement } from '@/lib/blockPlacement';
import { supabase } from '@/integrations/supabase/client';

// Custom hook for weather cycle - shared by sky and lighting
function useWeatherCycle(weatherSettings: {
  maxLighting: number;
  minLighting: number;
  cycleDuration: number;
}) {
  const [cycleState, setCycleState] = useState({
    lightingPercentage: weatherSettings.maxLighting,
    cyclePosition: 0,
    isNight: false
  });

  useFrame(() => {
    const cycleDurationMs = weatherSettings.cycleDuration * 60 * 1000;
    const currentTime = Date.now();
    const cyclePosition = (currentTime % cycleDurationMs) / cycleDurationMs;
    
    const sineWave = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
    const lightingPercentage = weatherSettings.minLighting + 
      (weatherSettings.maxLighting - weatherSettings.minLighting) * sineWave;
    
    const isNight = lightingPercentage < 40;
    
    setCycleState({ lightingPercentage, cyclePosition, isNight });
  });

  return cycleState;
}

// Sky component with space texture
function SkyTexture({ lightingPercentage }: { lightingPercentage: number }) {
  const { scene } = useThree();
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  
  useEffect(() => {
    const textureLoader = new THREE.TextureLoader();
    const skyGeo = new THREE.SphereGeometry(320, 64, 32);
    
    textureLoader.load('/space_night_sky.webp', (texture) => {
      // Crop edges to avoid white seam
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(0.995, 0.995); // Avoid 2-3 pixels on edges
      texture.offset.set(0.0025, 0.0025); // Center the cropped texture
      
      const skyMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        color: 0x0a0a0a, // Much darker base (4% brightness)
        transparent: true,
        opacity: 1
      });
      
      const skyMesh = new THREE.Mesh(skyGeo, skyMat);
      skyMeshRef.current = skyMesh;
      scene.add(skyMesh);
      
      return () => {
        scene.remove(skyMesh);
        skyGeo.dispose();
        skyMat.dispose();
        texture.dispose();
      };
    });
    
    return () => {
      skyGeo.dispose();
    };
  }, [scene]);

  // Update opacity based on lighting percentage
  useFrame(() => {
    if (skyMeshRef.current && skyMeshRef.current.material) {
      const material = skyMeshRef.current.material as THREE.MeshBasicMaterial;
      // Lighting goes from 0 to 100
      // At 100 (brightest), opacity should be 0
      // At 0 (darkest), opacity should be 1
      material.opacity = 1 - (lightingPercentage / 100);
    }
  });

  return null;
}

// Star field removed - using space texture instead

// Dynamic sky controller - now just displays space texture with dynamic opacity
function DynamicSky({ weatherSettings }: {
  weatherSettings: {
    maxLighting: number;
    minLighting: number;
    cycleDuration: number;
  }
}) {
  const { lightingPercentage } = useWeatherCycle(weatherSettings);
  return <SkyTexture lightingPercentage={lightingPercentage} />;
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
  onBlockRain
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
}) {
  const { camera, gl } = useThree();
  const isLocked = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const keys = useRef({
    w: false, s: false, a: false, d: false,
    shift: false, space: false, r: false
  });
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const onGround = useRef(true);
  const yaw = useRef(0);
  const pitch = useRef(0);
  
  // Use blocks from props instead of context (context doesn't cross Canvas boundary)
  const existingBlocks = blocks;
  
  // Firing rate limiting to prevent performance issues
  const lastFireTime = useRef(0);
  const FIRE_RATE_LIMIT = 150; // Minimum 150ms between shots

  // Collision boxes for fortress walls and placed blocks
  const colliders = useMemo(() => {
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

    // Add placed blocks as colliders for jumping/collision
    const blockColliders = existingBlocks.map(block => {
      const collider = new THREE.Box3(
        new THREE.Vector3(block.position_x - 0.5, block.position_y - 0.5, block.position_z - 0.5),
        new THREE.Vector3(block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5)
      );
      console.log(`Block collider at (${block.position_x}, ${block.position_y}, ${block.position_z}):`, collider);
      return collider;
    });
    
    console.log(`Total colliders: ${fortressColliders.length} fortress + ${blockColliders.length} blocks = ${fortressColliders.length + blockColliders.length}`);
    return [...fortressColliders, ...blockColliders];
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
        // Toggle block placement mode - check for any buildable block type
        console.log('B key pressed - current mode:', selectedBlockType ? 'building' : 'none');
        
        if (selectedBlockType) {
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
    } else if (blockPlacementMode && onBlockPlace) {
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
  }, [gl, showCrosshairs, onShoot, camera, blockPlacementMode, onBlockPlace, existingBlocks]);

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

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [handleKeyDown, handleKeyUp, handleMouseMove, handleWheel, handlePointerLockChange, handleClick, gl.domElement]);

  useFrame((state, delta) => {
    // Movement input
    direction.current.set(0, 0, 0);
    if (keys.current.w) direction.current.z += 1;
    if (keys.current.s) direction.current.z -= 1;
    if (keys.current.a) direction.current.x -= 1;
    if (keys.current.d) direction.current.x += 1;
    direction.current.normalize();

    // Speed calculation
    const baseSpeed = 4.0;
    const runSpeed = keys.current.shift ? 8.0 : baseSpeed;
    
    // Apply movement
    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    
    const deltaMovement = new THREE.Vector3();
    deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * delta);
    deltaMovement.addScaledVector(right, direction.current.x * runSpeed * delta);

    // Gravity and jumping
    velocity.current.y -= 9.8 * delta;
    if (keys.current.space && onGround.current) {
      velocity.current.y = 5.5;
      onGround.current = false;
    }
    deltaMovement.y += velocity.current.y * delta;

    // Store previous position for collision detection
    const prevPosition = camera.position.clone();
    camera.position.add(deltaMovement);

    // Ground collision
    if (camera.position.y < 1.6) {
      camera.position.y = 1.6;
      velocity.current.y = 0;
      onGround.current = true;
    } else {
      onGround.current = false;
    }

    // Wall and block collision detection - improved
    const playerRadius = 0.4;
    const playerHeight = 1.6;
    const playerBox = new THREE.Box3(
      new THREE.Vector3(
        camera.position.x - playerRadius,
        camera.position.y - playerHeight,
        camera.position.z - playerRadius
      ),
      new THREE.Vector3(
        camera.position.x + playerRadius,
        camera.position.y,
        camera.position.z + playerRadius
      )
    );
    
    for (const collider of colliders) {
      if (playerBox.intersectsBox(collider)) {
        // Calculate overlaps on all axes
        const centerDiffX = camera.position.x - (collider.min.x + collider.max.x) / 2;
        const centerDiffY = camera.position.y - (collider.min.y + collider.max.y) / 2;
        const centerDiffZ = camera.position.z - (collider.min.z + collider.max.z) / 2;
        
        const overlapX = Math.min(
          Math.abs(playerBox.max.x - collider.min.x),
          Math.abs(collider.max.x - playerBox.min.x)
        );
        const overlapY = Math.min(
          Math.abs(playerBox.max.y - collider.min.y),
          Math.abs(collider.max.y - playerBox.min.y)
        );
        const overlapZ = Math.min(
          Math.abs(playerBox.max.z - collider.min.z), 
          Math.abs(collider.max.z - playerBox.min.z)
        );
        
        // Resolve collision in direction of smallest overlap
        if (overlapY <= overlapX && overlapY <= overlapZ) {
          // Vertical collision
          if (centerDiffY > 0) {
            // Landing on top - only if moving downward
            if (velocity.current.y <= 0) {
              camera.position.y = collider.max.y + playerHeight;
              velocity.current.y = 0;
              onGround.current = true;
            }
          } else {
            // Hitting from below - only if moving upward  
            if (velocity.current.y > 0) {
              camera.position.y = collider.min.y;
              velocity.current.y = 0;
            }
          }
        } else if (overlapX <= overlapZ) {
          // Push along X axis
          camera.position.x = centerDiffX > 0 ? 
            collider.max.x + playerRadius + 0.01 : 
            collider.min.x - playerRadius - 0.01;
          // Don't reset Y velocity for horizontal collisions
        } else {
          // Push along Z axis  
          camera.position.z = centerDiffZ > 0 ? 
            collider.max.z + playerRadius + 0.01 : 
            collider.min.z - playerRadius - 0.01;
          // Don't reset Y velocity for horizontal collisions
        }
        break;
      }
    }
    
    // Check if standing on a block or ground for proper jumping - improved surface detection
    const feetPosition = camera.position.clone();
    feetPosition.y -= 1.6; // Offset to feet level
    
    let standingOnSurface = feetPosition.y <= 0.05; // Ground level with tighter tolerance
    
    // Check if standing on any block surface - only when not already colliding vertically
    if (!standingOnSurface && velocity.current.y <= 0.1) {
      for (const collider of colliders) {
        // Check if feet are directly on top of a block surface
        const tolerance = 0.05; // Much tighter tolerance
        if (feetPosition.x >= collider.min.x - 0.3 && feetPosition.x <= collider.max.x + 0.3 &&
            feetPosition.z >= collider.min.z - 0.3 && feetPosition.z <= collider.max.z + 0.3 &&
            Math.abs(feetPosition.y - collider.max.y) <= tolerance) {
          standingOnSurface = true;
          break;
        }
      }
    }
    
    // Only update ground state if not in a vertical collision
    if (!standingOnSurface || velocity.current.y > 0.1) {
      onGround.current = standingOnSurface;
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

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;
    
    // Accumulate time and spawn continuously
    timeAccumulatorRef.current += delta * 1000;
    
    while (timeAccumulatorRef.current >= msBetweeenDrops) {
      timeAccumulatorRef.current -= msBetweeenDrops;
      spawnDrop();
    }
    
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    
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
      
      matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
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

  // Load textures
  const cliffTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('/cliff_texture_seamless.webp');
  }, []);

  // Create individual textures for each wall with proper scaling
  const frontTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.6, 4); // (cliffW/2 - openingHalfW) / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const topTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.8, 3); // (openingHalfW*2) / 5, (cliffH-openingH) / 5
    return texture;
  }, [cliffTexture]);

  const sideTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4); // courtyardDepth / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const backTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 4); // cliffW / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const grassTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('/grass_texture_seamless.webp');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    return texture;
  }, []);

  return (
    <group>
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
          map={(() => {
            const texture = grassTexture.clone();
            // Calculate repeat based on the same scale as main ground (260x260 with 20x20 repeat = 13 units per repeat)
            // For courtyard: (cliffW-4) = 36, (courtyardDepth-2) = 28
            texture.repeat.set((cliffW-4)/13, (courtyardDepth-2)/13);
            return texture;
          })()} 
          metalness={0} 
          roughness={1} 
        />
      </mesh>
    </group>
  );
}

// Coins component using sprites
function Coins({ coinRate = 60, coinSize = 1.2, flowSpeed = 1.2, onGetCoins }: { 
  coinRate: number; 
  coinSize: number; 
  flowSpeed: number; 
  onGetCoins?: () => { position: THREE.Vector3; visible: boolean; mesh: THREE.Sprite | null }[];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coinTimerRef = useRef(0);
  const maxCoins = 5000;
  const maxExplosionParticles = 1000;
  
  // Load coin texture
  const coinTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('/waterfall_coin.png');
  }, []);
  
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
          <spriteMaterial map={coinTexture} transparent />
        </sprite>
      ))}
      {explosionParticles.map((particle, index) => (
        <sprite 
          key={`particle-${index}`} 
          ref={(ref) => { particle.mesh = ref; }}
          visible={false}
          scale={[0.5, 0.5, 1]}
        >
          <spriteMaterial map={coinTexture} transparent />
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

// Dynamic lighting component that uses shared weather cycle
function DynamicLighting({ weatherSettings }: { 
  weatherSettings: {
    maxLighting: number;
    minLighting: number;
    cycleDuration: number;
  } 
}) {
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  
  const { lightingPercentage } = useWeatherCycle(weatherSettings);
  
  useFrame(() => {
    const baseIntensity = lightingPercentage / 100;
    
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
  onBlockRain
}: {
  settings: { flowSpeed: number; msBetweeenDrops: number; coinRate: number; coinSize: number; colorPalette: any };
  onCoinHit: (position: THREE.Vector3) => void;
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
    maxLighting: number;
    minLighting: number;
    cycleDuration: number;
  };
  onBlockRain: () => void;
}) {
  // Performance-optimized bullet system with object pooling
  const MAX_BULLETS = 20; // Limit bullets to prevent memory issues
  const [bullets, setBullets] = useState<Array<{ position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number }>>([]);
  const [showCrosshairs, setShowCrosshairs] = useState(false);
  
  // Audio throttling to prevent rapid-fire audio issues
  const lastAudioTime = useRef(0);
  const AUDIO_THROTTLE = 100; // Minimum 100ms between audio plays
  
  // Get camera ref for block rain
  const { camera } = useThree();

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
      const { blockTypes, batchHandler } = customEvent.detail;
      
      console.log('Block rain event received in Scene component');
      
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
      
      // Calculate positions for 100 blocks randomly spread around target
      const spreadRadius = 5; // 5 blocks in each direction
      const blockPositions: Array<{ x: number; y: number; z: number; type: string }> = [];
      
      // Create positions for 100 blocks
      for (let i = 0; i < 100; i++) {
        const randomBlockType = blockTypes[Math.floor(Math.random() * blockTypes.length)];
        
        // Random position within spread radius
        const randomX = targetPosition.x + (Math.random() - 0.5) * spreadRadius * 2;
        const randomZ = targetPosition.z + (Math.random() - 0.5) * spreadRadius * 2;
        
        // Round to grid
        const gridX = Math.round(randomX);
        const gridZ = Math.round(randomZ);
        
        // Find the highest existing block at this X,Z position for stacking
        let groundY = 0;
        blocks.forEach(block => {
          if (Math.round(block.position_x) === gridX && Math.round(block.position_z) === gridZ) {
            groundY = Math.max(groundY, block.position_y + 1);
          }
        });
        
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
        await batchHandler(blockPositions);
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
      />
      
      {/* Dynamic Lighting with weather cycle */}
      <DynamicLighting weatherSettings={weatherSettings} />

      {/* Dynamic Sky with day/night cycle and stars */}
      <DynamicSky weatherSettings={weatherSettings} />

      {/* Fog */}
      <fog attach="fog" args={['#dff1ff', 0, 600]} />

      {/* Scene objects */}
      <Fortress />
      <BillboardWalls wallPositions={wallPositions} />
      <PlacedBlocks blocks={blocks} />
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
      />
      <Bullets bullets={bullets} />
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
              Click to lock mouse • WASD move • Shift run • Space jump • ESC unlock
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
    msBetweeenDrops: 1, // 1ms = 1000 drops per second
    coinRate: 6,
    coinSize: 0.8,
    colorPalette: defaultColorPalette
  });
  
  // Weather settings state
  const [weatherSettings, setWeatherSettings] = useState(() => {
    const stored = localStorage.getItem('weatherSettings');
    return stored ? JSON.parse(stored) : {
      maxLighting: 70,
      minLighting: 20,
      cycleDuration: 5 // minutes
    };
  });
  
  const [panelsVisible, setPanelsVisible] = useState(false);
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState<string | null>(null);
  
  // Wall positions state for real-time control
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  
  // User data and block system hooks
  const { profile, inventory, userRoles, addCoins, useBlock, refreshData } = useUserData();
  const { blocks, placeBlock, setBlockMode } = useBlocks();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isOpen: panelOpen, openPanel } = useUserPanel();
  const { openPanel: openAdminPanel } = useAdminPanel();
  
  
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
  
  const handleWeatherSettingsChange = (key: string, value: number) => {
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

  // Block Rain feature - spawns 100 random blocks for testing
  // Direct batch placement bypassing normal flow for performance
  const handleBlockRainBatch = useCallback(async (positions: Array<{ x: number; y: number; z: number; type: string }>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.error('User not authenticated for block rain');
        return;
      }

      // Prepare batch insert data
      const blocksToInsert = positions.map(pos => ({
        user_id: user.id,
        position_x: pos.x,
        position_y: pos.y,
        position_z: pos.z,
        block_type: pos.type
      }));

      console.log('Batch inserting', blocksToInsert.length, 'blocks...');
      
      // Single batch insert to Supabase
      const { data, error } = await supabase
        .from('placed_blocks')
        .insert(blocksToInsert)
        .select();

      if (error) {
        console.error('Batch insert error:', error);
        toast({
          title: "Block Rain Failed",
          description: "Some blocks couldn't be placed",
          variant: "destructive"
        });
        return;
      }

      console.log(`✓ Block Rain complete: ${data?.length || 0} blocks placed`);
      
      toast({
        title: "Block Rain Complete!",
        description: `${data?.length || 0} blocks spawned successfully`,
        duration: 2000
      });
      
      // Refresh blocks to show new ones
      await refreshData();
    } catch (error) {
      console.error('Block rain error:', error);
    }
  }, [toast, refreshData]);

  // Block Rain trigger - spawns 100 random blocks for testing
  const handleBlockRain = useCallback(() => {
    console.log('=== BLOCK RAIN TRIGGERED ===');
    
    // Get all available block types
    const blockTypes = ['fortress_block', 'grass_block', 'glowing_block', 'crystal_block'];
    
    // Trigger block rain in the Scene component via a custom event
    const event = new CustomEvent('triggerBlockRain', {
      detail: { blockTypes, batchHandler: handleBlockRainBatch }
    });
    window.dispatchEvent(event);
    
    toast({
      title: "Block Rain!",
      description: "Spawning 100 random blocks...",
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
        
        // Check if we still have blocks of this type after placing
        // Wait a moment for the inventory to update
        setTimeout(() => {
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
        }, 500); // Give time for inventory update to propagate
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
        setBlockMode(true); // Enable periodic syncing
        
        toast({
          title: "Block mode enabled",
          description: `Press left click to place ${availableItem.item_type}. Press B to exit.`,
          duration: 3000
        });
      } else {
        console.log('Cannot set block mode - no blocks available in inventory:', inventory);
        toast({
          title: "No blocks available",
          description: "You need to purchase blocks from the shop first (Press O to open shop)",
          variant: "destructive"
        });
      }
    } else if (mode === 'shooting') {
      console.log('Setting shooting mode');
      setSelectedBlockType(null);
      setCrosshairsEnabled(true);
      setBlockMode(false); // Disable periodic syncing
    } else {
      console.log('Setting null mode (exit block mode)');
      setSelectedBlockType(null);
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

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
      <Scene
        settings={settings}
        onCoinHit={handleCoinHit} 
        wallPositions={wallPositions}
        blockPlacementMode={!!selectedBlockType}
        onBlockPlace={handleBlockPlace}
        onModeChange={handleModeChange}
        onOpenPanel={handleOpenPanel}
        crosshairsEnabled={crosshairsEnabled}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        panelOpen={panelOpen}
        onCycleBlock={cycleSelectedBlock}
        blocks={blocks}
        weatherSettings={weatherSettings}
        onBlockRain={handleBlockRain}
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
          <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
        </div>
        {/* Coin count (clickable to open inventory) */}
        <div 
          className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-r border-l border-white/20"
          onClick={() => openPanel('inventory')}
          title="Open inventory"
        >
          <span className="font-bold">x{profile?.coins || 0}</span>
        </div>
      </div>
      
      {/* Block inventory */}
      <div className="flex items-center gap-2">
        {/* Block inventory - Only show total of blocks with quantity > 0 */}
        <div 
          className={`flex items-center gap-2 bg-black/50 text-white p-2 rounded cursor-pointer transition-colors ${
            selectedBlockType ? 'bg-blue-500/70' : 'hover:bg-black/70'
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
        {selectedBlockType && (
          <div className="bg-blue-500/70 text-white px-2 py-1 rounded text-xs">
            BLOCK MODE: {selectedBlockType}
          </div>
        )}
      </div>
    </div>
    
    {/* Instructions */}
    <div className="fixed bottom-4 right-4 z-20 text-white text-sm bg-black/50 p-2 rounded">
      <div>{selectedBlockType ? 'Click to place block • ESC to cancel' : 'R for crosshairs • Click to shoot'}</div>
      <div className="text-xs opacity-75 mt-1">
        B = Block mode • O = Open Shop • I = Inventory
      </div>
    </div>
    
    {/* User Panel (replaces BlockShop and Inventory) */}
    <UserPanel onBlockPurchased={handleBlockPurchased} />
    
    {/* Crosshair - conditional class for different modes */}
    <div className={`waterfall-crosshair ${
      selectedBlockType ? 'block-mode' : 
      crosshairsEnabled ? 'active' : ''
    }`} />
    
    {/* Toast notifications */}
    <Toaster />
    </div>
  );
}