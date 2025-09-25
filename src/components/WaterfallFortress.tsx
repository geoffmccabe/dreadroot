import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { BillboardControlPanel } from '@/components/BillboardControlPanel';
import { BillboardWalls } from '@/components/BillboardWalls';
import { BlockShop } from '@/components/BlockShop';
import { PlacedBlocks } from '@/components/PlacedBlocks';
import { BlockPreview } from '@/components/BlockPreview';
import { Inventory } from '@/components/Inventory';
import { useUserData } from '@/hooks/useUserData';
import { useBlocks } from '@/contexts/BlocksContext';
import { useToast } from '@/hooks/use-toast';
import { PlacedBlock } from '@/types/blocks';
import { Toaster } from '@/components/ui/toaster';

// Sky component with beautiful gradient
function SkyTexture() {
  const { scene } = useThree();
  
  useEffect(() => {
    // Create a beautiful gradient sky using a shader
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;
    
    // Create sky sphere with gradient shader
    const skyGeo = new THREE.SphereGeometry(320, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        topColor: { value: new THREE.Color(0x91c7f5) },    // Light blue
        bottomColor: { value: new THREE.Color(0xffffff) }, // White
        offset: { value: 33 },
        exponent: { value: 0.6 }
      },
      side: THREE.BackSide
    });
    
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
    
    return () => {
      scene.remove(skyMesh);
      skyGeo.dispose();
      skyMat.dispose();
    };
  }, [scene]);
  
  return null;
}

// First person controls component
function FirstPersonControls({ 
  onShoot, 
  showCrosshairs, 
  audioRefs, 
  playAudio,
  blockPlacementMode,
  onBlockPlace,
  onOpenShop,
  onOpenInventory,
  onModeChange,
  getBlockQuantity,
  selectedBlockType,
  shopOpen,
  inventoryOpen,
  onCycleBlock,
  blocks
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
  onOpenShop: () => void;
  onOpenInventory: () => void;
  onModeChange: (mode: 'shooting' | 'building' | null) => void;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  shopOpen: boolean;
  inventoryOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  blocks: PlacedBlock[];
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
  if (shopOpen || inventoryOpen || 
      document.activeElement?.tagName === 'INPUT' || 
      document.activeElement?.tagName === 'TEXTAREA') {
    return;
  }
  
  switch (event.code) {
    case 'KeyI':
      event.preventDefault(); // Prevent the 'i' from being typed in input fields
      onOpenInventory();
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
        if (!blockPlacementMode) {
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
        // Open shop
        if (!shopOpen) {
          onOpenShop();
        }
        break;
      case 'Escape':
        if (isLocked.current) {
          document.exitPointerLock();
        }
        break;
    }
  }, [crosshairsEnabled, onModeChange, onOpenShop, onOpenInventory, getBlockQuantity, selectedBlockType, shopOpen, inventoryOpen]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Don't process key events when dialogs are open or input fields are focused
    if (shopOpen || inventoryOpen || 
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
      
      
      // Create intersection targets (ground, existing blocks, fortress walls)
      const targets: THREE.Object3D[] = [];
      
      // Add ground plane with material for raycasting - make it more reliable
      const groundGeometry = new THREE.PlaneGeometry(200, 200);
      const groundMaterial = new THREE.MeshBasicMaterial({ 
        visible: false,
        side: THREE.DoubleSide // Ensure both sides are detectable
      });
      const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.set(0, 0, 0);
      groundMesh.name = 'ground'; // For debugging
      targets.push(groundMesh);
      
      // Constants for fortress dimensions
      const cliffW = 40, cliffH = 20, frontT = 2;
      const courtyardDepth = 30, frontZ = -8;
      const openingHalfW = 2;
      
      // Add fortress walls as collision targets with proper dimensions and positions
      const fortressWalls = [
        // Front left pillar
        { position: [-(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ], size: [cliffW/2 - openingHalfW, cliffH, frontT] },
        // Front right pillar  
        { position: [(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ], size: [cliffW/2 - openingHalfW, cliffH, frontT] },
        // Left wall
        { position: [-cliffW/2 + 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2], size: [2, cliffH, courtyardDepth + frontT] },
        // Right wall  
        { position: [cliffW/2 - 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2], size: [2, cliffH, courtyardDepth + frontT] },
        // Back wall
        { position: [0, cliffH/2, frontZ - courtyardDepth - frontT], size: [cliffW, cliffH, 2] },
        // Courtyard floor
        { position: [0, 0.01, frontZ - courtyardDepth/2 - frontT/2], size: [cliffW-4, 0.1, courtyardDepth-2] }
      ];
      
      const wallMaterial = new THREE.MeshBasicMaterial({ visible: false }); // Invisible but detectable
      fortressWalls.forEach(wall => {
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]), 
          wallMaterial
        );
        wallMesh.position.set(wall.position[0], wall.position[1], wall.position[2]);
        targets.push(wallMesh);
      });
      
      // Add existing blocks to collision targets with materials
      if (existingBlocks && existingBlocks.length > 0) {
        const blockMaterial = new THREE.MeshBasicMaterial({ 
          visible: false,
          side: THREE.DoubleSide
        });
        existingBlocks.forEach((block, index) => {
          const blockMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1), 
            blockMaterial
          );
          blockMesh.position.set(block.position_x, block.position_y, block.position_z);
          blockMesh.name = `block-${index}`; // For debugging
          targets.push(blockMesh);
        });
      }
      
      console.log(`Created ${targets.length} raycasting targets:`, targets.map(t => t.name || 'unnamed'));
      console.log('Raycaster origin:', camera.position, 'direction:', direction);
      
      // Find intersection
      const intersects = raycaster.intersectObjects(targets, true);
      console.log(`Found ${intersects.length} intersections:`, intersects.map(i => ({
        object: i.object.name || 'unnamed',
        point: i.point,
        distance: i.distance
      })));
      
      if (intersects.length > 0) {
        const intersection = intersects[0];
        const hitPoint = intersection.point;
        const normal = intersection.face?.normal;
        
        console.log('Block placement intersection details:', {
          point: hitPoint,
          normal: normal,
          object: intersection.object.name || 'unnamed',
          distance: intersection.distance
        });
        
        if (normal) {
          // Calculate placement position adjacent to hit surface
          const placePosition = hitPoint.clone().add(normal.clone().multiplyScalar(0.5));
          
          // Snap to voxel grid (place ON grid positions, not between)
          placePosition.x = Math.round(placePosition.x);
          placePosition.y = Math.round(placePosition.y);
          placePosition.z = Math.round(placePosition.z);
          
          // Ensure minimum height (place ON grid, not between)
          placePosition.y = Math.max(0, Math.round(placePosition.y));
          
          console.log('Calculated placement position:', placePosition);
          
          // Check placement restrictions
          const fortressCenter = new THREE.Vector3(0, 0, -20);
          const distanceToFortress = placePosition.distanceTo(fortressCenter);
          const waterfallZ = -6;
          const waterfallBlockingWidth = 4;
          
          // Validate placement
          const tooCloseToFortress = distanceToFortress < 30;
          const blockingWaterfall = Math.abs(placePosition.x) < waterfallBlockingWidth / 2 && placePosition.z > waterfallZ;
          
          // Check for block overlap - blocks are 1x1x1 units, so use stricter tolerance
          let blockOverlap = false;
          if (existingBlocks && existingBlocks.length > 0) {
            blockOverlap = existingBlocks.some(block => 
              Math.abs(block.position_x - placePosition.x) < 0.9 && 
              Math.abs(block.position_y - placePosition.y) < 0.9 && 
              Math.abs(block.position_z - placePosition.z) < 0.9
            );
            console.log('Block overlap check:', {
              existingBlockCount: existingBlocks.length,
              placePosition,
              blockOverlap,
              nearbyBlocks: existingBlocks.filter(block => 
                Math.abs(block.position_x - placePosition.x) < 2 && 
                Math.abs(block.position_y - placePosition.y) < 2 && 
                Math.abs(block.position_z - placePosition.z) < 2
              )
            });
          }
          
          console.log('Placement validation:', {
            tooCloseToFortress,
            blockingWaterfall, 
            blockOverlap,
            position: placePosition,
            distanceToFortress,
            selectedBlockType
          });
          
          if (!tooCloseToFortress && !blockingWaterfall && !blockOverlap) {
            console.log('Valid placement, calling onBlockPlace with selectedBlockType:', selectedBlockType);
            onBlockPlace(placePosition);
          } else {
            console.log('Invalid placement due to restrictions');
            // Show user feedback for invalid placement
            if (tooCloseToFortress) console.log('Too close to fortress');
            if (blockingWaterfall) console.log('Blocking waterfall'); 
            if (blockOverlap) console.log('Block overlap detected');
          }
        }
      } else {
        console.log('No intersection found for block placement - raycaster may not be hitting any objects');
        // Try fallback placement at reasonable distance in front of player (same as BlockPreview)
        const distance = 3;
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(camera.quaternion);
        
        const groundPosition = camera.position.clone().add(direction.multiplyScalar(distance));
        
        // Snap to voxel grid
        groundPosition.x = Math.round(groundPosition.x);
        groundPosition.y = Math.max(0, Math.round(groundPosition.y)); // Keep above ground
        groundPosition.z = Math.round(groundPosition.z);
        
        console.log('Fallback placement 3 units ahead at:', groundPosition);
        onBlockPlace(groundPosition);
      }
      
      // Clean up temporary objects
      targets.forEach(target => {
        const mesh = target as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => mat.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
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

// Waterfall component matching original exactly
function Waterfall({ flowSpeed = 1.2, dropCount = 6000, colorPalette }: { 
  flowSpeed: number; 
  dropCount: number; 
  colorPalette: Array<{ hex: string; weight: number; }>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Float32Array>();
  const prevDropCount = useRef(dropCount);
  
  const fall = {
    width: 6, // Made 2m wider (1m on each side)
    depth: 0.6,
    topY: 19.95, // cliffH - 0.05
    bottomY: 0.2,
    centerX: 0,
    z: -5.95 // frontZ + frontT/2 + 0.05
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

  // Halton sequence for better distribution (from original)
  const halton = useCallback((i: number, base: number) => {
    let f = 1;
    let result = 0;
    while (i > 0) {
      f /= base;
      result += f * (i % base);
      i = Math.floor(i / base);
    }
    return result;
  }, []);

  // Recreate drops when count changes - using original HTML method
  useEffect(() => {
    if (prevDropCount.current !== dropCount) {
      prevDropCount.current = dropCount;
      
      if (pointsRef.current) {
        // Dispose old geometry
        pointsRef.current.geometry.dispose();
        
        // Create new geometry
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(dropCount * 3);
        const colors = new Float32Array(dropCount * 3);
        
        // Create new velocities array (not used in original simple method)
        velocitiesRef.current = new Float32Array(dropCount);
        
        const rangeY = fall.topY - fall.bottomY;
        
        // EXACT method from working HTML version
        for (let i = 0; i < dropCount; i++) {
          const u = halton(i + 1, 2);
          const v = halton(i + 1, 3);  
          const w = halton(i + 1, 5);
          
          // Initial positioning exactly like original HTML
          positions[i * 3] = fall.centerX + (u - 0.5) * fall.width;
          positions[i * 3 + 1] = fall.bottomY + w * rangeY;  // Simple distribution like HTML
          positions[i * 3 + 2] = fall.z + (v - 0.5) * fall.depth;
          
          const color = pickColor();
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
          
          // Not used in simple method
          velocitiesRef.current[i] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsRef.current.geometry = geometry;
      }
    }
  }, [dropCount, halton, pickColor]);

  // Initial setup - using original HTML method for better distribution
  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(dropCount * 3);
    const colors = new Float32Array(dropCount * 3);
    
    velocitiesRef.current = new Float32Array(dropCount);
    
    const rangeY = fall.topY - fall.bottomY;
    
    // EXACT method from working HTML version
    for (let i = 0; i < dropCount; i++) {
      const u = halton(i + 1, 2);
      const v = halton(i + 1, 3);  
      const w = halton(i + 1, 5);
      
      // Initial positioning exactly like original HTML
      positions[i * 3] = fall.centerX + (u - 0.5) * fall.width;
      positions[i * 3 + 1] = fall.bottomY + w * rangeY;  // Simple distribution like HTML
      positions[i * 3 + 2] = fall.z + (v - 0.5) * fall.depth;
      
      const color = pickColor();
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      // Not used in simple method
      velocitiesRef.current[i] = 0;
    }
    
    return { positions, colors };
  }, [halton, pickColor, dropCount]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    
    const positionAttribute = pointsRef.current.geometry.attributes.position;
    const colorAttribute = pointsRef.current.geometry.attributes.color;
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;
    
    // EXACT physics from original HTML
    const mul = flowSpeed; // This matches the original "mul" variable
    
    for (let i = 0; i < dropCount; i++) {
      let y = positions[i * 3 + 1];
      y -= (5.5 * mul) * delta; // Exact formula from original
      
      if (y <= fall.bottomY) {
        // Reset drop EXACTLY like original HTML
        positions[i * 3] = fall.centerX + (Math.random() - 0.5) * fall.width;
        y = fall.topY - Math.random() * (fall.topY - fall.bottomY); // Exact original formula
        positions[i * 3 + 2] = fall.z + (Math.random() - 0.5) * fall.depth;
        
        // Update color exactly like original (with needsUpdate check)
        const color = pickColor();
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        colorAttribute.needsUpdate = true;
      }
      
      positions[i * 3 + 1] = y;
    }
    
    positionAttribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={dropCount}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={dropCount}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.2}
        vertexColors
        transparent
        opacity={1.0}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        fog={false}
      />
    </points>
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

// Coins component using sprites like the original
function Coins({ coinRate = 60, coinSize = 1.2, flowSpeed = 1.2, onGetCoins }: { 
  coinRate: number; 
  coinSize: number; 
  flowSpeed: number; 
  onGetCoins?: () => { position: THREE.Vector3; visible: boolean; mesh: THREE.Sprite | null }[];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coinAccumulator = useRef(0);
  const maxCoins = 800; // Match original
  
  // Load coin texture
  const coinTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('/waterfall_coin.png');
  }, []);
  
  const coins = useMemo(() => {
    const coinsArray = [];
    for (let i = 0; i < maxCoins; i++) {
      coinsArray.push({
        position: new THREE.Vector3(0, 20, -6 + (Math.random() - 0.5) * 0.6), // Start at fortress height
        velocity: 0,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * Math.PI * 2,
        scaleJitter: 1 + (Math.random() * 0.4 - 0.2),
        visible: false,
        mesh: null as THREE.Sprite | null
      });
    }
    return coinsArray;
  }, [maxCoins]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // Spawn coins exactly like original
    coinAccumulator.current += coinRate * delta;
    while (coinAccumulator.current >= 1) {
      const availableCoin = coins.find(c => !c.visible);
      if (availableCoin) {
        availableCoin.visible = true;
        availableCoin.position.set(
          (Math.random() - 0.5) * 4, // fall.width
          20, // Start at fortress height
          -6 + (Math.random() - 0.5) * 0.6 // fall.z + fall.depth
        );
        availableCoin.velocity = 0;
        availableCoin.rotation = Math.random() * Math.PI * 2;
        availableCoin.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 2;
      }
      coinAccumulator.current -= 1;
    }

    // Update coin physics exactly like original
    const gravity = 9.8 * flowSpeed;
    coins.forEach((coin) => {
      if (!coin.visible || !coin.mesh) return;
      
      coin.velocity += gravity * delta;
      coin.position.y -= coin.velocity * delta;
      coin.rotation += coin.rotSpeed * delta;
      
      // Update mesh position and rotation
      coin.mesh.position.copy(coin.position);
      coin.mesh.material.rotation = coin.rotation;
      
      if (coin.position.y <= 0.2) {
        coin.visible = false;
        // Remove from rendering by clearing mesh reference
        if (coin.mesh) {
          coin.mesh.visible = false;
        }
      }
    });
  });

  // Expose coins for bullet collision detection
  useEffect(() => {
    if (onGetCoins) {
      (window as any).getCoins = () => coins;
    }
  }, [coins, onGetCoins]);

  return (
    <group ref={groupRef}>
      {coins.map((coin, index) => 
        coin.visible && (
          <sprite 
            key={index} 
            ref={(ref) => { 
              coin.mesh = ref; 
              if (ref) ref.visible = true;
            }}
            position={[coin.position.x, coin.position.y, coin.position.z]} 
            scale={[coinSize * coin.scaleJitter, coinSize * coin.scaleJitter, 1]}
          >
            <spriteMaterial map={coinTexture} transparent />
          </sprite>
        )
      )}
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

// Scene component
// Scene component with audio management and performance optimization
function Scene({ 
  settings, 
  onCoinHit, 
  wallPositions, 
  blockPlacementMode, 
  onBlockPlace,
  onModeChange,
  onOpenShop,
  onOpenInventory,
  crosshairsEnabled,
  getBlockQuantity,
  selectedBlockType,
  shopOpen,
  inventoryOpen,
  onCycleBlock,
  blocks
}: { 
  settings: { flowSpeed: number; dropCount: number; coinRate: number; coinSize: number; colorPalette: any };
  onCoinHit: (position: THREE.Vector3) => void;
  wallPositions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>;
  blockPlacementMode: boolean;
  onBlockPlace: (position: THREE.Vector3) => void;
  onModeChange: (mode: 'shooting' | 'building' | null) => void;
  onOpenShop: () => void;
  onOpenInventory: () => void;
  crosshairsEnabled: boolean;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  shopOpen: boolean;
  inventoryOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  blocks: PlacedBlock[];
}) {
  // Performance-optimized bullet system with object pooling
  const MAX_BULLETS = 20; // Limit bullets to prevent memory issues
  const [bullets, setBullets] = useState<Array<{ position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number }>>([]);
  const [showCrosshairs, setShowCrosshairs] = useState(false);
  
  // Audio throttling to prevent rapid-fire audio issues
  const lastAudioTime = useRef(0);
  const AUDIO_THROTTLE = 100; // Minimum 100ms between audio plays

  // Single audio context and optimized audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRefs = useRef({
    pistolCocking: new Audio('/pistol_cocking_sound.mp3'),
    pistolHolster: new Audio('/holster_pistol_sound.mp3'),
    gunshot: new Audio('/space_gunshot.mp3'),
    coinHit: new Audio('/coin_hit_sound.mp3'),
    woodenThud: new Audio('/wooden_thud_sound.mp3')
  });

  // Initialize audio context and preload sounds (optimized)
  useEffect(() => {
    // Create single audio context
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      // Cleanup audio context only on unmount
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
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
        onOpenShop={onOpenShop}
        onOpenInventory={onOpenInventory}
        onModeChange={onModeChange}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        shopOpen={shopOpen}
        inventoryOpen={inventoryOpen}
        onCycleBlock={onCycleBlock}
        blocks={blocks}
      />
      
      {/* Lighting */}
      <hemisphereLight args={['#ffffff', '#edfff6', 1.1]} />
      <directionalLight
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
      <ambientLight intensity={0.25} />

      {/* HDRI Sky */}
      <SkyTexture />

      {/* Fog */}
      <fog attach="fog" args={['#dff1ff', 0, 600]} />

      {/* Scene objects */}
      <Fortress />
      <BillboardWalls wallPositions={wallPositions} />
      <PlacedBlocks blocks={blocks} />
      <Waterfall
        flowSpeed={settings.flowSpeed} 
        dropCount={settings.dropCount} 
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
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-4 z-20 space-y-4 max-w-md">
      <Card className="waterfall-card">
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
              <Label className="text-xs opacity-85">Drops count</Label>
              <Slider
                value={[settings.dropCount]}
                onValueChange={([value]) => onSettingsChange('dropCount', value)}
                min={500}
                max={15000}
                step={100}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.dropCount}</span>
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
    dropCount: 6000,
    coinRate: 6,
    coinSize: 0.8,
    colorPalette: defaultColorPalette
  });
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState<string | null>(null);
  
  // Wall positions state for real-time control
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  
  // User data and block system hooks
  const { profile, inventory, addCoins, useBlock, refreshData } = useUserData();
  const { blocks, placeBlock, setBlockMode } = useBlocks();
  const { toast } = useToast();
  
  
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
    console.log('Mode change requested:', mode, 'Current inventory items with quantity > 0:', inventory.filter(item => item.quantity > 0).map(item => `${item.item_type}:${item.quantity}`));
    
    if (mode === 'building') {
      // Find first available block type from inventory
      const availableItem = inventory.find(item => item.quantity > 0);
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

  // Shop and inventory handlers
  const handleOpenShop = useCallback(() => {
    setShopOpen(true);
  }, []);

  const handleOpenInventory = useCallback(() => {
    setInventoryOpen(true);
  }, []);

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
        onOpenShop={handleOpenShop}
        onOpenInventory={handleOpenInventory}
        crosshairsEnabled={crosshairsEnabled}
        getBlockQuantity={getBlockQuantity}
        selectedBlockType={selectedBlockType}
        shopOpen={shopOpen}
        inventoryOpen={inventoryOpen}
        onCycleBlock={cycleSelectedBlock}
        blocks={blocks}
      />
      
      {/* Block Preview */}
      {selectedBlockType && (
        <BlockPreview 
          blockType={selectedBlockType}
          visible={true}
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

    {/* Panel visibility toggle button */}
    <Button
      className="fixed top-4 right-4 z-30 waterfall-button"
      size="sm"
      onClick={() => {
        console.log('Panel toggle clicked, current panelsVisible:', panelsVisible);
        try {
          setPanelsVisible(!panelsVisible);
          console.log('Panel visibility set to:', !panelsVisible);
        } catch (error) {
          console.error('Error toggling panels:', error);
        }
      }}
    >
      {panelsVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
    
    <ControlPanel 
      settings={settings} 
      onSettingsChange={handleSettingsChange}
      isVisible={panelsVisible}
    />
    
    {/* Billboard Control Panel - positioned below the Waterfall panel */}
    <div className="fixed top-4 left-4 z-20 space-y-4 max-w-md" style={{ marginTop: '320px' }}>
      <BillboardControlPanel 
        isVisible={panelsVisible} 
        onWallPositionsChange={setWallPositions}
      />
    </div>
    
    {/* Score display and block inventory */}
    <div className="fixed bottom-4 left-4 z-20 flex items-center gap-2">
      {/* Coin display with separated click areas */}
      <div className="flex items-center gap-0 bg-black/50 text-white rounded">
        {/* Shooting mode button area (around coin icon) */}
        <div 
          className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-l"
          onClick={() => handleModeChange('shooting')}
          title="Switch to shooting mode"
        >
          <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
        </div>
        {/* Coin count (clickable to open shop) */}
        <div 
          className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-r border-l border-white/20"
          onClick={() => handleOpenShop()}
          title="Open shop"
        >
          <span className="font-bold">x{profile?.coins || 0}</span>
        </div>
      </div>
      
      {/* Block inventory */}
      <div className="flex items-center gap-2">
        <div 
          className={`flex items-center gap-2 bg-black/50 text-white p-2 rounded cursor-pointer transition-colors ${
            selectedBlockType ? 'bg-blue-500/70' : 'hover:bg-black/70'
          }`}
          onClick={() => {
            const totalBlocks = inventory.reduce((total, item) => total + item.quantity, 0);
            if (totalBlocks > 0) {
              handleModeChange(selectedBlockType ? null : 'building');
            } else {
              handleOpenShop();
            }
          }}
          title={inventory.reduce((total, item) => total + item.quantity, 0) > 0 ? 
            (selectedBlockType ? "Exit block mode" : "Enter block mode") : 
            "Buy blocks from shop"
          }
        >
          <div className="w-6 h-6 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center">
            <div className="w-4 h-4 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
          </div>
          <span className="font-bold">x{inventory.reduce((total, item) => total + item.quantity, 0)}</span>
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
    {panelsVisible && (
      <div className="fixed bottom-4 right-4 z-20 text-white text-sm bg-black/50 p-2 rounded">
        <div>{selectedBlockType ? 'Click to place block • ESC to cancel' : 'R for crosshairs • Click to shoot'}</div>
        <div className="text-xs opacity-75 mt-1">
          B = Block mode • O = Open Shop • I = Inventory
        </div>
      </div>
    )}
    
    {/* Block Shop Modal */}
    <BlockShop 
      isOpen={shopOpen}
      onClose={() => setShopOpen(false)}
      onBlockPurchased={handleBlockPurchased}
    />
    
    {/* Inventory Modal */}
    <Inventory 
      isOpen={inventoryOpen}
      onClose={() => setInventoryOpen(false)}
    />
    
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