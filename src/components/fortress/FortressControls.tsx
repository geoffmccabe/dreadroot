import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import * as THREE from 'three';
import { useRaycaster } from '@/hooks/useRaycaster';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { PlacedBlock } from '@/types/blocks';
import { 
  DEBUG_LOGGING, 
  FirstPersonControlsProps 
} from './FortressTypes';
import {
  createFortressColliders,
  checkAxisCollision,
  findStepUpTarget,
  createPlayerBox,
  resetFortressGridState
} from './FortressCollision';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { collisionGrid } from '@/lib/spatialHashGrid';

export function FirstPersonControls({ 
  onShoot, 
  showCrosshairs, 
  audioRefs, 
  playAudio,
  blockPlacementMode,
  treePlacementMode,
  onBlockPlace,
  onTreePlace,
  onOpenPanel,
  onModeChange,
  getBlockQuantity,
  selectedBlockType,
  selectedSeedTier,
  panelOpen,
  onCycleBlock,
  onCycleSeed,
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
  blocksByTypeAndUser,
  onGodModeChange,
  updatePlayerPosition,
  applyKnockback: externalApplyKnockback,
  respawnPosition,
  onRespawnComplete,
  isOwnedTreeAtPosition,
  onTreeChopComplete,
  onTreeChopProgress
}: FirstPersonControlsProps & { onGodModeChange?: (enabled: boolean) => void }) {
  const { camera, gl } = useThree();
  const { raycastMeshes } = useRaycaster();
  const isLocked = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const keys = useRef({
    w: false, s: false, a: false, d: false,
    shift: false, space: false, r: false, ctrl: false,
    previouslyCtrl: false, rightMouse: false,
    q: false, z: false
  });
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  
  // God Mode state (fly + noclip for admins/superadmins)
  const godModeRef = useRef(false);
  const [godModeEnabled, setGodModeEnabled] = useState(false);
  const onGround = useRef(true);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const lastGroundCheck = useRef(0);
  const stuckTimer = useRef(0);
  const lastPositionLog = useRef(0);
  
  // Knockback velocity for shwarm hits (decays over time)
  const knockbackVelRef = useRef(new THREE.Vector3());
  
  // Reusable Vector3 objects to prevent garbage collection
  const forwardVecRef = useRef(new THREE.Vector3());
  const rightVecRef = useRef(new THREE.Vector3());
  const deltaMovementRef = useRef(new THREE.Vector3());
  
  // Additional reusable vectors for collision detection (avoid .clone() in hot loop)
  const prevPositionRef = useRef(new THREE.Vector3());
  const testPosRef = useRef(new THREE.Vector3());
  const feetCheckPosRef = useRef(new THREE.Vector3());
  
  // Reusable Box3 objects for step-up mechanic
  const stepUpPlayerBoxRef = useRef(new THREE.Box3());
  const stepUpClearanceBoxRef = useRef(new THREE.Box3());
  
  // Reusable vectors for shooting (avoid allocations on every shot)
  const shootDirectionRef = useRef(new THREE.Vector3());
  const shootOriginRef = useRef(new THREE.Vector3());
  
  // Throttle ref for hover detection (avoid per-frame setState!)
  const lastHoverCheckRef = useRef(0);
  
  // Throttle ref for position broadcast (every 50ms = 20Hz, not every frame)
  const lastBroadcastRef = useRef(0);
  const BROADCAST_INTERVAL = 50; // ms
  const existingBlocks = blocks;
  
  // Firing rate limiting
  const lastFireTime = useRef(0);
  const FIRE_RATE_LIMIT = 150;
  
  // Tree chopping state - Minecraft style hold-to-chop
  const CHOP_INTERVAL_MS = 350; // Time between chops (like Minecraft)
  const CHOPS_REQUIRED = 5; // Number of chops to trigger modal
  const leftMouseDownRef = useRef(false);
  const chopStartTimeRef = useRef(0);
  const chopCountRef = useRef(0);
  const choppingPositionRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastChopSoundTimeRef = useRef(0);
  const axeChopAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Initialize axe chop audio once
  useEffect(() => {
    axeChopAudioRef.current = new Audio('/axe_chop.mp3');
    axeChopAudioRef.current.volume = 0.5;
  }, []);

  const gridInitialized = useRef(false);
  
  // Apply knockback function - can be called externally via prop or internally
  const applyKnockback = useCallback((direction: THREE.Vector3, distance: number) => {
    // Calculate velocity needed to travel 'distance' over ~0.2 seconds
    const secondsToApply = 0.2;
    knockbackVelRef.current.addScaledVector(direction, distance / secondsToApply);
  }, []);
  
  // Expose applyKnockback to parent via ref pattern
  useEffect(() => {
    if (externalApplyKnockback) {
      // Parent provided a callback - they can call our internal function
      // For now, we expose via a global for shwarm system to access
      (window as any).__applyPlayerKnockback = applyKnockback;
    }
    return () => {
      delete (window as any).__applyPlayerKnockback;
    };
  }, [applyKnockback, externalApplyKnockback]);
  
  // Initialize fortress colliders on mount
  // NOTE: We no longer clear the grid here because block colliders from useChunkLoader
  // may already be present and clearing them causes collision bugs
  useEffect(() => {
    if (!gridInitialized.current) {
      // Just reset fortress state to ensure fortress colliders get added
      // Don't clear the whole grid - block colliders are already there!
      resetFortressGridState();
      gridInitialized.current = true;
    }
  }, []);

  // Handle respawn position - teleport player when respawnPosition changes
  useEffect(() => {
    if (respawnPosition) {
      camera.position.copy(respawnPosition);
      velocity.current.set(0, 0, 0);
      knockbackVelRef.current.set(0, 0, 0);
      onRespawnComplete?.();
    }
  }, [respawnPosition, camera, onRespawnComplete]);
  
  // Collision boxes for fortress walls only (block colliders are now managed by useChunkLoader)
  const collidersArrayRef = useRef<THREE.Box3[]>([]);
  
  // Get fortress colliders once - they're static
  useMemo(() => {
    const fortressColliders = createFortressColliders();
    
    collidersArrayRef.current.length = 0;
    for (let i = 0; i < fortressColliders.length; i++) {
      collidersArrayRef.current.push(fortressColliders[i]);
    }
  }, []);
  
  const colliders = collidersArrayRef.current;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
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
        if (event.shiftKey) {
          event.preventDefault();
          onBlockRain();
        } else if (!blockPlacementMode) {
          const newCrosshairsState = !showCrosshairs;
          onModeChange(newCrosshairsState ? 'shooting' : null);
          const audio = newCrosshairsState ? audioRefs.pistolCocking : audioRefs.pistolHolster;
          playAudio(audio);
        } else {
          onModeChange('shooting');
          playAudio(audioRefs.pistolCocking);
        }
        break;
      case 'KeyB':
        if (blockPlacementMode) {
          onModeChange(null);
        } else {
          onModeChange('building');
        }
        break;
      case 'KeyT':
        if (treePlacementMode) {
          onModeChange(null);
        } else {
          onModeChange('planting');
        }
        break;
      case 'KeyO':
        event.preventDefault();
        onOpenPanel('store');
        break;
      case 'BracketLeft':
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('prev');
        } else if (treePlacementMode) {
          event.preventDefault();
          onCycleSeed('prev');
        }
        break;
      case 'BracketRight':
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('next');
        } else if (treePlacementMode) {
          event.preventDefault();
          onCycleSeed('next');
        }
        break;
      case 'Escape':
        if (isLocked.current) {
          document.exitPointerLock();
        }
        break;
      case 'Backquote': // ~ key for God Mode
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          godModeRef.current = !godModeRef.current;
          setGodModeEnabled(godModeRef.current);
          onGodModeChange?.(godModeRef.current);
        }
        break;
      case 'F9': // Debug: show nearby colliders and clear orphans
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          event.preventDefault();
          console.log(`[Debug] Camera at: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`);
          console.log(`[Debug] Total colliders in grid: ${collisionGrid.size}`);
          (collisionGrid as any).debugNearby?.(camera.position.x, camera.position.z, 5);
        }
        break;
      case 'F10': // Emergency: clear entire collision grid and rebuild
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          event.preventDefault();
          console.log('[Debug] EMERGENCY: Clearing entire collision grid!');
          collisionGrid.clear();
          resetFortressGridState(); // Allow fortress colliders to be re-added
          console.log('[Debug] Grid cleared. Colliders will rebuild on next frame.');
        }
        break;
      case 'KeyQ':
        keys.current.q = true;
        break;
      case 'KeyZ':
        keys.current.z = true;
        break;
    }
  }, [crosshairsEnabled, onModeChange, onOpenPanel, getBlockQuantity, selectedBlockType, panelOpen, blockPlacementMode, showCrosshairs, audioRefs, playAudio, onBlockRain, onCycleBlock, userRoles, onGodModeChange]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
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
      case 'KeyQ':
        keys.current.q = false;
        break;
      case 'KeyZ':
        keys.current.z = false;
        break;
    }
  }, [panelOpen]);

  // Euler for camera rotation
  const eulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const needsCameraUpdate = useRef(false);
  
  // Handler refs to prevent event listener re-attachment
  const handleMouseMoveRef = useRef<(event: MouseEvent) => void>();
  const handleWheelRef = useRef<(event: WheelEvent) => void>();
  const handleClickRef = useRef<() => void>();
  const handleRightClickRef = useRef<(event: MouseEvent) => void>();
  const handleMouseDownRef = useRef<(event: MouseEvent) => void>();
  const handleMouseUpRef = useRef<(event: MouseEvent) => void>();
  const handlePointerLockChangeRef = useRef<() => void>();

  // Mouse tracking for debugging
  const mouseDebugData = useRef({
    totalEvents: 0,
    nonZeroEvents: 0,
    leftDriftEvents: 0,
    rightDriftEvents: 0,
    phantomEventsFiltered: 0,
    recentMovements: [] as Array<{x: number, y: number, timestamp: number}>
  });
  const lastMovements = useRef<Array<{x: number, y: number}>>([]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    
    mouseDebugData.current.totalEvents++;
    if (event.movementX !== 0 || event.movementY !== 0) {
      mouseDebugData.current.nonZeroEvents++;
    }
    if (event.movementX < 0) mouseDebugData.current.leftDriftEvents++;
    if (event.movementX > 0) mouseDebugData.current.rightDriftEvents++;
    
    lastMovements.current.push({x: event.movementX, y: event.movementY});
    if (lastMovements.current.length > 5) lastMovements.current.shift();
    
    // Phantom event detection
    if (lastMovements.current.length >= 4) {
      const last4 = lastMovements.current.slice(-4);
      const allIdentical = last4.every(m => m.x === last4[0].x && m.y === last4[0].y);
      const allTiny = last4.every(m => Math.abs(m.x) <= 1 && Math.abs(m.y) <= 1);
      
      if (allIdentical && allTiny && (Math.abs(event.movementX) > 0 || Math.abs(event.movementY) > 0)) {
        mouseDebugData.current.phantomEventsFiltered++;
        return;
      }
    }
    
    mouseDebugData.current.recentMovements.push({
      x: event.movementX,
      y: event.movementY,
      timestamp: Date.now()
    });
    if (mouseDebugData.current.recentMovements.length > 100) {
      mouseDebugData.current.recentMovements.shift();
    }
    
    const sensitivity = 0.002;
    yaw.current += -event.movementX * sensitivity;
    pitch.current += -event.movementY * sensitivity;
    
    const maxPitch = Math.PI / 2 - 0.01;
    pitch.current = Math.max(-maxPitch, Math.min(maxPitch, pitch.current));
    needsCameraUpdate.current = true;
  }, []);
  
  handleMouseMoveRef.current = handleMouseMove;

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!isLocked.current) return;
    if (blockPlacementMode) {
      event.preventDefault();
      onCycleBlock(event.deltaY > 0 ? 'next' : 'prev');
    } else if (treePlacementMode) {
      event.preventDefault();
      onCycleSeed(event.deltaY > 0 ? 'next' : 'prev');
    }
  }, [blockPlacementMode, treePlacementMode, onCycleBlock, onCycleSeed]);
  
  handleWheelRef.current = handleWheel;

  const handleClick = useCallback(() => {
    if (!isLocked.current) {
      gl.domElement.requestPointerLock();
      return;
    }
    
    if (blockPlacementMode && showOwnershipOutline && hoveredBlockId && onBlockRemove) {
      onBlockRemove(hoveredBlockId);
      setHoveredBlockId(null);
      return;
    }
    
    if (blockPlacementMode && onBlockPlace) {
      // Use fast voxel raycast - ZERO allocations, O(ray length)
      const placementResult = calculatePlacementFast(
        camera,
        existingBlocks || [],
        5
      );
      
      if (placementResult.isValid) {
        // Create Vector3 for callback (only allocation on successful placement)
        const position = new THREE.Vector3(
          placementResult.x,
          placementResult.y,
          placementResult.z
        );
        onBlockPlace(position);
      } else {
        // Play rejection sound
        try {
          const rejectionData = (window as any).__rejectionSound;
          if (rejectionData?.buffer) {
            let ctx = rejectionData.audioContext;
            if (!ctx || ctx.state === 'closed') {
              ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              (window as any).__rejectionSound.audioContext = ctx;
            }
            if (ctx.state === 'suspended') ctx.resume();
            
            const source = ctx.createBufferSource();
            source.buffer = rejectionData.buffer;
            source.playbackRate.value = 1.0;
            source.detune.value = -1712;
            const gainNode = ctx.createGain();
            gainNode.gain.value = 1.5;
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            source.start(0);
            source.stop(ctx.currentTime + rejectionData.buffer.duration / 2);
          }
        } catch (e) {
          console.warn('Could not play rejection sound:', e);
        }
      }
    } else if (treePlacementMode && onTreePlace) {
      // Use same voxel raycast for tree placement
      const placementResult = calculatePlacementFast(
        camera,
        existingBlocks || [],
        5
      );
      
      if (placementResult.isValid) {
        const position = new THREE.Vector3(
          placementResult.x,
          placementResult.y,
          placementResult.z
        );
        onTreePlace(position);
      }
    } else if (showCrosshairs && onShoot) {
      const now = Date.now();
      if (now - lastFireTime.current < FIRE_RATE_LIMIT) return;
      lastFireTime.current = now;
      
      // Reuse vectors instead of allocating new ones
      shootDirectionRef.current.set(0, 0, -1);
      shootDirectionRef.current.applyQuaternion(camera.quaternion);
      shootOriginRef.current.copy(camera.position);
      onShoot(shootOriginRef.current, shootDirectionRef.current);
      playAudio(audioRefs.gunshot);
    }
  }, [gl, showCrosshairs, onShoot, camera, blockPlacementMode, treePlacementMode, onBlockPlace, onTreePlace, existingBlocks, selectedBlockType, showOwnershipOutline, hoveredBlockId, onBlockRemove, setHoveredBlockId, audioRefs, playAudio]);
  
  handleClickRef.current = handleClick;

  const handleRightClick = useCallback((event: MouseEvent) => {
    if (!isLocked.current || !blockPlacementMode || !showOwnershipOutline) return;
    event.preventDefault();
  }, [blockPlacementMode, showOwnershipOutline]);
  
  handleRightClickRef.current = handleRightClick;

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    if (event.button === 2) keys.current.rightMouse = true;
    if (event.button === 0) {
      leftMouseDownRef.current = true;
      chopStartTimeRef.current = performance.now();
      chopCountRef.current = 0;
      choppingPositionRef.current = null;
    }
  }, []);
  
  handleMouseDownRef.current = handleMouseDown;

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (event.button === 2) {
      keys.current.rightMouse = false;
      setHoveredBlockId(null);
    }
    if (event.button === 0) {
      leftMouseDownRef.current = false;
      chopCountRef.current = 0;
      choppingPositionRef.current = null;
      // Reset progress when releasing
      onTreeChopProgress?.(0, CHOPS_REQUIRED);
    }
  }, [setHoveredBlockId, onTreeChopProgress]);
  
  handleMouseUpRef.current = handleMouseUp;

  const handlePointerLockChange = useCallback(() => {
    isLocked.current = document.pointerLockElement === gl.domElement;
  }, [gl]);
  
  handlePointerLockChangeRef.current = handlePointerLockChange;

  // Stable wrapper functions
  const stableMouseMoveListener = useCallback((event: MouseEvent) => {
    handleMouseMoveRef.current?.(event);
  }, []);
  const stableWheelListener = useCallback((event: WheelEvent) => {
    handleWheelRef.current?.(event);
  }, []);
  const stableClickListener = useCallback(() => {
    handleClickRef.current?.();
  }, []);
  const stableRightClickListener = useCallback((event: MouseEvent) => {
    handleRightClickRef.current?.(event);
  }, []);
  const stableMouseDownListener = useCallback((event: MouseEvent) => {
    handleMouseDownRef.current?.(event);
  }, []);
  const stableMouseUpListener = useCallback((event: MouseEvent) => {
    handleMouseUpRef.current?.(event);
  }, []);
  const stablePointerLockChangeListener = useCallback(() => {
    handlePointerLockChangeRef.current?.();
  }, []);

  // Attach event listeners ONCE
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', stableMouseMoveListener);
    document.addEventListener('wheel', stableWheelListener);
    document.addEventListener('pointerlockchange', stablePointerLockChangeListener);
    gl.domElement.addEventListener('click', stableClickListener);
    gl.domElement.addEventListener('contextmenu', stableRightClickListener);
    gl.domElement.addEventListener('mousedown', stableMouseDownListener);
    gl.domElement.addEventListener('mouseup', stableMouseUpListener);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', stableMouseMoveListener);
      document.removeEventListener('wheel', stableWheelListener);
      document.removeEventListener('pointerlockchange', stablePointerLockChangeListener);
      gl.domElement.removeEventListener('click', stableClickListener);
      gl.domElement.removeEventListener('contextmenu', stableRightClickListener);
      gl.domElement.removeEventListener('mousedown', stableMouseDownListener);
      gl.domElement.removeEventListener('mouseup', stableMouseUpListener);
    };
  }, [handleKeyDown, handleKeyUp, gl.domElement, stableMouseMoveListener, stableWheelListener, stableClickListener, stableRightClickListener, stableMouseDownListener, stableMouseUpListener, stablePointerLockChangeListener]);

  // Store refs for values needed in frame loop to avoid stale closures
  const collidersRef = useRef(colliders);
  const userRolesRef = useRef(userRoles);
  const blockPlacementModeRef = useRef(blockPlacementMode);
  const showOwnershipOutlineRef = useRef(showOwnershipOutline);
  const currentUserIdRef = useRef(currentUserId);
  const hoveredBlockIdRef = useRef(hoveredBlockId);
  const broadcastPositionRef = useRef(broadcastPosition);
  const updatePlayerPositionRef = useRef(updatePlayerPosition);
  
  // Tree chopping refs
  const isOwnedTreeAtPositionRef = useRef(isOwnedTreeAtPosition);
  const onTreeChopCompleteRef = useRef(onTreeChopComplete);
  const onTreeChopProgressRef = useRef(onTreeChopProgress);
  
  // Phase 2B: Throttle for chunk loading updates (separate from broadcast)
  const lastChunkUpdateRef = useRef(0);
  const CHUNK_UPDATE_INTERVAL = 500; // ms - less frequent than broadcast
  
  useEffect(() => { collidersRef.current = colliders; }, [colliders]);
  useEffect(() => { userRolesRef.current = userRoles; }, [userRoles]);
  useEffect(() => { blockPlacementModeRef.current = blockPlacementMode; }, [blockPlacementMode]);
  useEffect(() => { showOwnershipOutlineRef.current = showOwnershipOutline; }, [showOwnershipOutline]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);
  useEffect(() => { hoveredBlockIdRef.current = hoveredBlockId; }, [hoveredBlockId]);
  useEffect(() => { broadcastPositionRef.current = broadcastPosition; }, [broadcastPosition]);
  useEffect(() => { updatePlayerPositionRef.current = updatePlayerPosition; }, [updatePlayerPosition]);
  useEffect(() => { isOwnedTreeAtPositionRef.current = isOwnedTreeAtPosition; }, [isOwnedTreeAtPosition]);
  useEffect(() => { onTreeChopCompleteRef.current = onTreeChopComplete; }, [onTreeChopComplete]);
  useEffect(() => { onTreeChopProgressRef.current = onTreeChopProgress; }, [onTreeChopProgress]);

  // Movement and collision frame loop - register with centralized loop
  useEffect(() => {
    const unregister = frameLoop.register('controls', (delta) => {
      // Note: useFrameCallCount only tracked in master loop now
      
      // Apply camera rotation if needed
      if (needsCameraUpdate.current) {
        eulerRef.current.set(pitch.current, yaw.current, 0);
        camera.quaternion.setFromEuler(eulerRef.current);
        needsCameraUpdate.current = false;
      }

      // Block hover detection for removal - THROTTLED to avoid per-frame setState
      // Only check every 100ms and only call setState when value actually changes
      const now = performance.now();
      if (blockPlacementModeRef.current && showOwnershipOutlineRef.current && keys.current.rightMouse) {
        if (now - lastHoverCheckRef.current > 100) { // Throttle to 10fps
          lastHoverCheckRef.current = now;
          
          const meshesArray = meshesArrayCache.current;
          let newHoveredId: string | null = null;
          
          if (meshesArray.length > 0) {
            const result = raycastMeshes(meshesArray, 5);
            
            if (result && result.instanceId !== undefined) {
              const blockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);
              if (blockType && currentUserIdRef.current) {
                const userBlocks = blocksByTypeAndUser.current.get(`${blockType}_${currentUserIdRef.current}`);
                if (userBlocks && result.instanceId < userBlocks.length) {
                  const block = userBlocks[result.instanceId];
                  if (block && block.user_id === currentUserIdRef.current) {
                    newHoveredId = block.id;
                  }
                }
              }
            }
          }
          
          // Only call setState if value actually changed
          if (newHoveredId !== hoveredBlockIdRef.current) {
            setHoveredBlockId(newHoveredId);
          }
        }
      } else if (hoveredBlockIdRef.current) {
        setHoveredBlockId(null);
      }
      
      // Tree chopping detection - hold left mouse on owned tree blocks (not in shooting mode)
      // Debug: Log every 60 frames to avoid spam
      if (leftMouseDownRef.current && Math.random() < 0.02) {
        console.log('[TreeChop] leftMouseDown=true, showCrosshairs=', showCrosshairs, 'isOwnedTreeAtPositionRef.current=', !!isOwnedTreeAtPositionRef.current);
      }
      
      if (leftMouseDownRef.current && !showCrosshairs && isOwnedTreeAtPositionRef.current) {
        // Raycast to find what we're looking at
        const meshesArray = meshesArrayCache.current;
        console.log('[TreeChop] meshesArray.length=', meshesArray.length, 'meshToBlockTypeCache size=', meshToBlockTypeCache.current.size);
        if (meshesArray.length > 0) {
          const result = raycastMeshes(meshesArray, 15); // Increase raycast distance
          console.log('[TreeChop] Raycast result:', result ? 'HIT' : 'MISS', result?.instanceId, result?.distance);
          
          if (result && result.instanceId !== undefined) {
            const blockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);
            console.log('[TreeChop] Hit block type:', blockType);
            
            // Check if it's a trunk block (tree block)
            if (blockType === 'trunk') {
              // Get the block position from the instanced mesh matrix
              const mesh = result.object as THREE.InstancedMesh;
              const matrix = new THREE.Matrix4();
              mesh.getMatrixAt(result.instanceId, matrix);
              const position = new THREE.Vector3();
              position.setFromMatrixPosition(matrix);
              
              const blockX = Math.round(position.x);
              const blockY = Math.round(position.y);
              const blockZ = Math.round(position.z);
              
              // Check if this is an owned tree
              if (isOwnedTreeAtPositionRef.current(blockX, blockY, blockZ)) {
                // Initialize or continue chopping on this position
                const isNewBlock = !choppingPositionRef.current || 
                    choppingPositionRef.current.x !== blockX ||
                    choppingPositionRef.current.y !== blockY ||
                    choppingPositionRef.current.z !== blockZ;
                
                if (isNewBlock) {
                  // Started chopping a new block - reset progress
                  choppingPositionRef.current = { x: blockX, y: blockY, z: blockZ };
                  chopCountRef.current = 0;
                  // Set to past time so first chop happens immediately
                  lastChopSoundTimeRef.current = now - CHOP_INTERVAL_MS;
                  console.log('[TreeChop] Started new chop on block:', blockX, blockY, blockZ);
                }
                
                const timeSinceLastChop = now - lastChopSoundTimeRef.current;
                
                // Check if enough time passed for next chop
                if (timeSinceLastChop >= CHOP_INTERVAL_MS) {
                  lastChopSoundTimeRef.current = now;
                  chopCountRef.current++;
                  
                  console.log('[TreeChop] CHOP!', chopCountRef.current, '/', CHOPS_REQUIRED, 'audio ref:', !!axeChopAudioRef.current);
                  
                  // Play chop sound
                  if (axeChopAudioRef.current) {
                    axeChopAudioRef.current.currentTime = 0;
                    axeChopAudioRef.current.play().catch((e) => console.log('[TreeChop] Audio error:', e));
                  }
                  
                  // Report progress
                  if (onTreeChopProgressRef.current) {
                    onTreeChopProgressRef.current(chopCountRef.current, CHOPS_REQUIRED);
                  }
                  
                  // Check if we've reached the required chops
                  if (chopCountRef.current >= CHOPS_REQUIRED) {
                    console.log('[TreeChop] Complete! Calling onTreeChopComplete');
                    // Trigger the confirmation modal via callback
                    if (onTreeChopCompleteRef.current) {
                      onTreeChopCompleteRef.current(blockX, blockY, blockZ);
                    }
                    
                    // Reset state
                    leftMouseDownRef.current = false;
                    chopCountRef.current = 0;
                    choppingPositionRef.current = null;
                  }
                }
              } else {
                // Not an owned tree - reset chopping state
                choppingPositionRef.current = null;
                chopCountRef.current = 0;
              }
            } else {
              // Not looking at a trunk - reset chopping state
              choppingPositionRef.current = null;
              chopCountRef.current = 0;
            }
          } else {
            // Not looking at any block - reset chopping state
            choppingPositionRef.current = null;
            chopCountRef.current = 0;
          }
        }
      } else if (!leftMouseDownRef.current && chopCountRef.current > 0) {
        // Mouse released - reset chopping
        choppingPositionRef.current = null;
        chopCountRef.current = 0;
      }
      
      // Movement input
      direction.current.set(0, 0, 0);
      if (keys.current.w) direction.current.z += 1;
      if (keys.current.s) direction.current.z -= 1;
      if (keys.current.a) direction.current.x -= 1;
      if (keys.current.d) direction.current.x += 1;
      direction.current.normalize();

      // Speed calculation - god mode gets faster speed
      const baseSpeed = 4.0;
      const crawlSpeed = baseSpeed * 0.6;
      const godSpeed = keys.current.shift ? 16.0 : 8.0; // Faster in god mode
      const runSpeed = godModeRef.current 
        ? godSpeed 
        : (keys.current.ctrl ? crawlSpeed : (keys.current.shift ? 8.0 : baseSpeed));
      
      // Apply movement
      const forward = forwardVecRef.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      const right = rightVecRef.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      
      const deltaMovement = deltaMovementRef.current.set(0, 0, 0);
      deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * delta);
      deltaMovement.addScaledVector(right, direction.current.x * runSpeed * delta);
      
      // Apply knockback velocity (decays over time)
      if (knockbackVelRef.current.lengthSq() > 0.0001) {
        deltaMovement.x += knockbackVelRef.current.x * delta;
        deltaMovement.z += knockbackVelRef.current.z * delta;
        
        // Fast decay (knockback dissipates in ~0.2 seconds)
        knockbackVelRef.current.multiplyScalar(Math.pow(0.05, delta));
        if (knockbackVelRef.current.lengthSq() < 0.0001) {
          knockbackVelRef.current.set(0, 0, 0);
        }
      }

      // God Mode: Q = fly up, Z = fly down, no gravity
      if (godModeRef.current) {
        // Vertical movement with Q/Z
        if (keys.current.q) {
          deltaMovement.y += runSpeed * delta;
        }
        if (keys.current.z) {
          deltaMovement.y -= runSpeed * delta;
        }
        // No gravity in god mode - just apply direct movement
        velocity.current.set(0, 0, 0);
        camera.position.add(deltaMovement);
        onGround.current = false;
        
        // Broadcast position to multiplayer (throttled to 20Hz)
        if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
          lastBroadcastRef.current = now;
          const broadcast = broadcastPositionRef.current;
          if (broadcast) {
            broadcast(camera.position, yaw.current, pitch.current);
          }
        }
        return; // Skip normal physics
      }

      // Normal physics below (only when NOT in god mode)
      // Gravity and jumping
      velocity.current.y -= 9.8 * delta;

      // Player dimensions
      const playerRadius = 0.3;
      const isCrawling = keys.current.ctrl;
      const standingHeight = 1.6;
      const crawlingHeight = 0.8;
      const playerHeight = isCrawling ? crawlingHeight : standingHeight;

      // Store previous position
      prevPositionRef.current.copy(camera.position);
      let xBlocked = false;
      let zBlocked = false;
      
      const currentColliders = collidersRef.current;
      
      // Only check stuck-in-block when trying to jump (saves a collision check per frame)
      const stuckInBlock = keys.current.space && !onGround.current 
        ? checkAxisCollision(camera.position, currentColliders, playerRadius, standingHeight, false, true) !== null
        : false;
      
      // Allow jumping if on ground OR stuck inside a block (escape mechanism)
      const canJump = (onGround.current || stuckInBlock) && !keys.current.ctrl;
      const roles = userRolesRef.current;
      
      if (keys.current.space && canJump) {
        let jumpHeight = 1.25;
        if (roles.includes('admin') || roles.includes('superadmin')) {
          jumpHeight = 2.5;
        }
        // Give extra boost if stuck to help escape
        if (stuckInBlock && !onGround.current) {
          jumpHeight *= 1.5;
        }
        velocity.current.y = Math.sqrt(2 * 9.8 * jumpHeight);
        onGround.current = false;
      }
      deltaMovement.y += velocity.current.y * delta;
      
      // Note: isMoving used implicitly - throttling happens inside checkAxisCollision

      // X-axis collision - only check if moving horizontally
      if (deltaMovement.x !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.x += deltaMovement.x;
        
        if (checkAxisCollision(testPosRef.current, currentColliders, playerRadius, playerHeight, true)) {
          camera.position.x = prevPositionRef.current.x;
          velocity.current.x = 0;
          xBlocked = true;
        } else {
          camera.position.x = testPosRef.current.x;
        }
      }

      // Z-axis collision - only check if moving horizontally
      if (deltaMovement.z !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.z += deltaMovement.z;
        
        if (checkAxisCollision(testPosRef.current, currentColliders, playerRadius, playerHeight, true)) {
          camera.position.z = prevPositionRef.current.z;
          velocity.current.z = 0;
          zBlocked = true;
        } else {
          camera.position.z = testPosRef.current.z;
        }
      }

      // Y-axis collision - always check when there's vertical movement
      if (deltaMovement.y !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.y += deltaMovement.y;
        
        // Force check for Y-axis since it's critical for ground detection
        const collision = checkAxisCollision(testPosRef.current, currentColliders, playerRadius, playerHeight, false, true);
        if (collision) {
          if (velocity.current.y < 0) {
            camera.position.y = collision.max.y + playerHeight;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            camera.position.y = collision.min.y - 0.01;
            velocity.current.y = 0;
          }
        } else {
          if (testPosRef.current.y < playerHeight && velocity.current.y < 0) {
            camera.position.y = playerHeight;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            camera.position.y = testPosRef.current.y;
            onGround.current = false;
          }
        }
      }

      // Step-up mechanic
      const stepUpHeight = 0.6;
      const isMovingHorizontally = Math.abs(deltaMovementRef.current.x) > 0.001 || Math.abs(deltaMovementRef.current.z) > 0.001;
      
      if ((xBlocked || zBlocked) && onGround.current && isMovingHorizontally) {
        const stepUpY = findStepUpTarget(
          camera,
          currentColliders,
          playerRadius,
          playerHeight,
          stepUpHeight,
          stepUpPlayerBoxRef.current,
          stepUpClearanceBoxRef.current
        );
        
        if (stepUpY !== null) {
          camera.position.y = stepUpY + playerHeight;
          velocity.current.y = 0;
          onGround.current = true;
        }
      }
      
      // Ground detection - only check when potentially in air or landing
      const needsGroundCheck = !onGround.current || velocity.current.y < -0.1;
      if (needsGroundCheck) {
        const feetY = camera.position.y - playerHeight;
        const onGroundLevel = feetY <= 0.05 && Math.abs(velocity.current.y) < 0.1;
        feetCheckPosRef.current.copy(camera.position);
        feetCheckPosRef.current.y = camera.position.y - playerHeight - 0.05;
        const hasBlockBeneath = checkAxisCollision(feetCheckPosRef.current, currentColliders, playerRadius, playerHeight, false, true);
        
        if (onGroundLevel || (hasBlockBeneath && Math.abs(velocity.current.y) < 0.1)) {
          onGround.current = true;
        } else {
          onGround.current = false;
        }
      }
      
      // Broadcast position to multiplayer (throttled to 20Hz)
      if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
        lastBroadcastRef.current = now;
        const broadcast = broadcastPositionRef.current;
        if (broadcast) {
          broadcast(camera.position, yaw.current, pitch.current);
        }
      }
      
      // Phase 2B: Update player position for chunk loading (throttled to 2Hz)
      if (now - lastChunkUpdateRef.current >= CHUNK_UPDATE_INTERVAL) {
        lastChunkUpdateRef.current = now;
        const chunkUpdate = updatePlayerPositionRef.current;
        if (chunkUpdate) {
          chunkUpdate(camera.position.x, camera.position.z);
        }
      }
    }, 20); // High priority - controls run early

    return unregister;
  }, [camera, raycastMeshes, setHoveredBlockId]);

  return null;
}
