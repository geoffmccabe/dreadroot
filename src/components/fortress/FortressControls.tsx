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
  checkAxisCollisionFromCandidates,
  findStepUpTarget,
  findStepUpTargetFromCandidates,
  createPlayerBox,
  resetFortressGridState,
  findPushOutDirection
} from './FortressCollision';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { isTreeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';

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
  onTreeChopProgress,
  onBulletTierChange,
  // Pentabullet props
  playerLevel = 1,
  onPentabulletChargeChange
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
  // Glide mode: activated by pressing G while falling, auto-deactivates on landing
  const glideActiveRef = useRef(false);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  
  // R-mode for bullet tier selection (admin only) - press R, then 1-0 to select tier
  const rModeActiveRef = useRef(false);
  const rModeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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
  
  // Pentabullet charging state
  const pentabulletChargeStartRef = useRef<number | null>(null);
  const pentabulletChargeRef = useRef(0);
  const pentabulletPowerupAudioRef = useRef<HTMLAudioElement | null>(null);
  const pentabulletSteadyAudioRef = useRef<HTMLAudioElement | null>(null);
  const pentabulletPhaseRef = useRef<'idle' | 'powerup' | 'steady'>('idle');
  const playerLevelRef = useRef(playerLevel);
  
  // Track previous crawl state for crouch height transition
  const wasCrawlingRef = useRef(false);
  
  // Initialize axe chop audio once
  useEffect(() => {
    axeChopAudioRef.current = new Audio('/axe_chop.mp3');
    axeChopAudioRef.current.volume = 0.5;
  }, []);
  
  // Keep player level ref updated
  useEffect(() => {
    playerLevelRef.current = playerLevel;
  }, [playerLevel]);

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
        onOpenPanel('blocks');
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
        // Block rain: Shift+R but NOT if Command/Meta is held (allows Cmd+Shift+R for browser refresh)
        if (event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          onBlockRain();
        } else if (!event.shiftKey && !blockPlacementMode) {
          const newCrosshairsState = !showCrosshairs;
          onModeChange(newCrosshairsState ? 'shooting' : null);
          const audio = newCrosshairsState ? audioRefs.pistolCocking : audioRefs.pistolHolster;
          playAudio(audio);
          
          // For admins: activate R-mode for bullet tier selection (2 second window)
          if (newCrosshairsState && (userRoles.includes('admin') || userRoles.includes('superadmin')) && onBulletTierChange) {
            rModeActiveRef.current = true;
            if (rModeTimeoutRef.current) clearTimeout(rModeTimeoutRef.current);
            rModeTimeoutRef.current = setTimeout(() => {
              rModeActiveRef.current = false;
            }, 2000);
          }
        } else if (!event.shiftKey) {
          onModeChange('shooting');
          playAudio(audioRefs.pistolCocking);
          
          // For admins: activate R-mode for bullet tier selection (2 second window)
          if ((userRoles.includes('admin') || userRoles.includes('superadmin')) && onBulletTierChange) {
            rModeActiveRef.current = true;
            if (rModeTimeoutRef.current) clearTimeout(rModeTimeoutRef.current);
            rModeTimeoutRef.current = setTimeout(() => {
              rModeActiveRef.current = false;
            }, 2000);
          }
        }
        break;
      // Number keys 1-0 for bullet tier selection (admin only, after pressing R)
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9':
      case 'Digit0':
        if (rModeActiveRef.current && onBulletTierChange && (userRoles.includes('admin') || userRoles.includes('superadmin'))) {
          event.preventDefault();
          // Digit0 = tier 10, Digit1-9 = tier 1-9
          const tier = event.code === 'Digit0' ? 10 : parseInt(event.code.replace('Digit', ''));
          onBulletTierChange(tier);
          rModeActiveRef.current = false;
          if (rModeTimeoutRef.current) {
            clearTimeout(rModeTimeoutRef.current);
            rModeTimeoutRef.current = null;
          }
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
        onOpenPanel('market');
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
      case 'Backquote': // ~ key (Shift+`) for God Mode
        if (event.shiftKey && (userRoles.includes('admin') || userRoles.includes('superadmin'))) {
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
      case 'Digit0': // Also 0 key (with Shift) - Mac-friendly alternative: Shift+0
        if (event.code === 'Digit0' && !event.shiftKey) break; // Only Shift+0 triggers clear
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          event.preventDefault();
          const oldSize = collisionGrid.size;
          console.log('[Debug] EMERGENCY: Clearing entire collision grid!');
          collisionGrid.clear();

          // Immediately reinsert fortress colliders (block colliders are reinserted by the chunk loader listener).
          resetFortressGridState();
          createFortressColliders();

          const newSize = collisionGrid.size;
          console.log(`[Debug] Grid cleared. Was ${oldSize}, now ${newSize} (fortress). Blocks will rebuild via collisionGridCleared event.`);
          
          // Show toast so user knows it worked
          alert(`Collision grid cleared! Was: ${oldSize} → Now: ${newSize} colliders`);
        }
        break;
      case 'KeyQ':
        keys.current.q = true;
        break;
      case 'KeyZ':
        keys.current.z = true;
        break;
      case 'KeyG':
        // Glide mode: only activates if currently falling (not on ground)
        if (!onGround.current && velocity.current.y < 0) {
          glideActiveRef.current = true;
        }
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
    
    const movementX = event.movementX;
    const movementY = event.movementY;
    
    lastMovements.current.push({x: movementX, y: movementY});
    if (lastMovements.current.length > 8) lastMovements.current.shift();
    
    // Aggressive phantom event detection - filter consistent tiny drift patterns
    // Check for immediate leftward drift (common Pointer Lock API bug)
    if (movementX === -1 && movementY === 0) {
      // Count consecutive left drift events
      const recentLeftCount = lastMovements.current.filter(m => m.x === -1 && m.y === 0).length;
      if (recentLeftCount >= 2) {
        mouseDebugData.current.phantomEventsFiltered++;
        return;
      }
    }
    
    // Filter any consistent tiny movements (phantom events from browser)
    if (lastMovements.current.length >= 2) {
      const last2 = lastMovements.current.slice(-2);
      const allIdentical = last2.every(m => m.x === movementX && m.y === movementY);
      const allTiny = Math.abs(movementX) <= 1 && Math.abs(movementY) <= 1;
      const notZero = movementX !== 0 || movementY !== 0;
      
      if (allIdentical && allTiny && notZero) {
        mouseDebugData.current.phantomEventsFiltered++;
        return;
      }
    }
    
    mouseDebugData.current.recentMovements.push({
      x: movementX,
      y: movementY,
      timestamp: Date.now()
    });
    if (mouseDebugData.current.recentMovements.length > 100) {
      mouseDebugData.current.recentMovements.shift();
    }
    
    const sensitivity = 0.002;
    yaw.current += -movementX * sensitivity;
    pitch.current += -movementY * sensitivity;
    
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
      // Skip normal shot if pentabullet is charging (>1s hold)
      if (pentabulletChargeRef.current >= 1.0) {
        return; // Will fire pentabullet or cancel on mouseup
      }
      
      const now = Date.now();
      if (now - lastFireTime.current < FIRE_RATE_LIMIT) return;
      lastFireTime.current = now;
      
      // Calculate shoot direction from camera orientation
      shootDirectionRef.current.set(0, 0, -1);
      shootDirectionRef.current.applyQuaternion(camera.quaternion);
      shootDirectionRef.current.normalize();
      
      // Bullet starts exactly at camera position - no offset needed
      // The bullet will travel in the exact direction the camera is facing
      shootOriginRef.current.copy(camera.position);
      
      onShoot(shootOriginRef.current, shootDirectionRef.current);
      
      // Play gunshot with random ±5% speed and pitch variation for organic feel
      const audio = audioRefs.gunshot;
      if (audio) {
        const variation = 0.95 + Math.random() * 0.1; // 0.95 to 1.05
        audio.playbackRate = variation;
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    }
  }, [gl, showCrosshairs, onShoot, camera, blockPlacementMode, treePlacementMode, onBlockPlace, onTreePlace, existingBlocks, selectedBlockType, showOwnershipOutline, hoveredBlockId, onBlockRemove, setHoveredBlockId, audioRefs, playAudio]);
  
  handleClickRef.current = handleClick;

  // Cancel pentabullet charge helper
  const cancelPentabulletCharge = useCallback(() => {
    if (pentabulletPhaseRef.current !== 'idle') {
      // Play powerdown sound
      const powerdownAudio = new Audio('/pentabullet_powerdown.mp3');
      powerdownAudio.volume = 0.5;
      powerdownAudio.play().catch(() => {});
      
      // Stop any playing charge sounds
      if (pentabulletPowerupAudioRef.current) {
        pentabulletPowerupAudioRef.current.pause();
        pentabulletPowerupAudioRef.current.currentTime = 0;
      }
      if (pentabulletSteadyAudioRef.current) {
        pentabulletSteadyAudioRef.current.pause();
        pentabulletSteadyAudioRef.current.currentTime = 0;
      }
    }
    pentabulletChargeStartRef.current = null;
    pentabulletChargeRef.current = 0;
    pentabulletPhaseRef.current = 'idle';
    onPentabulletChargeChange?.(0);
  }, [onPentabulletChargeChange]);
  
  // Calculate pentabullet directions with spread based on player level
  // First bullet fires true, others spread ±5% minus 0.1% per level
  const calculatePentabulletDirections = useCallback((baseDirection: THREE.Vector3): THREE.Vector3[] => {
    // Base spread: 5% angle (0.05 radians) minus 0.1% per level
    const spreadAngle = Math.max(0.005, 0.05 - (playerLevelRef.current * 0.001));
    
    const directions: THREE.Vector3[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(baseDirection, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, baseDirection).normalize();
    
    // First bullet fires true (straight)
    directions.push(baseDirection.clone());
    
    // Remaining 4 bullets spread randomly from the base direction
    for (let i = 1; i < 5; i++) {
      const dir = baseDirection.clone();
      
      // Random angular offset within spread cone
      const theta = Math.random() * Math.PI * 2; // Random angle around cone
      const phi = Math.random() * spreadAngle; // Random distance from center
      
      // Apply rotation to direction
      dir.addScaledVector(right, Math.cos(theta) * Math.sin(phi));
      dir.addScaledVector(realUp, Math.sin(theta) * Math.sin(phi));
      dir.normalize();
      
      directions.push(dir);
    }
    return directions;
  }, []);
  
  // Fire pentabullet (5 bullets with spread, 0.1s apart)
  const firePentabullet = useCallback(() => {
    if (!onShoot) return;
    
    // Stop charging sounds
    if (pentabulletPowerupAudioRef.current) {
      pentabulletPowerupAudioRef.current.pause();
      pentabulletPowerupAudioRef.current.currentTime = 0;
    }
    if (pentabulletSteadyAudioRef.current) {
      pentabulletSteadyAudioRef.current.pause();
      pentabulletSteadyAudioRef.current.currentTime = 0;
    }
    
    // Calculate base direction from camera
    const baseDirection = new THREE.Vector3(0, 0, -1);
    baseDirection.applyQuaternion(camera.quaternion);
    baseDirection.normalize();
    
    // Get all 5 bullet directions
    const directions = calculatePentabulletDirections(baseDirection);
    
    // Play pentabullet fire sound
    const fireAudio = new Audio('/pentabullet_sound.mp3');
    fireAudio.volume = 0.6;
    fireAudio.play().catch(() => {});
    
    // Fire bullets 0.1 seconds apart using the existing onShoot callback
    const origin = camera.position.clone();
    directions.forEach((dir, index) => {
      setTimeout(() => {
        onShoot(origin.clone(), dir);
      }, index * 100); // 0.1 seconds apart
    });
    
    // Reset state
    pentabulletChargeStartRef.current = null;
    pentabulletChargeRef.current = 0;
    pentabulletPhaseRef.current = 'idle';
    onPentabulletChargeChange?.(0);
  }, [camera, calculatePentabulletDirections, onShoot, onPentabulletChargeChange]);
  
  const handleRightClick = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    
    // Cancel pentabullet charge on right-click
    if (pentabulletPhaseRef.current !== 'idle') {
      event.preventDefault();
      cancelPentabulletCharge();
      return;
    }
    
    if (!blockPlacementMode || !showOwnershipOutline) return;
    event.preventDefault();
  }, [blockPlacementMode, showOwnershipOutline, cancelPentabulletCharge]);
  
  handleRightClickRef.current = handleRightClick;

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    if (event.button === 2) keys.current.rightMouse = true;
    if (event.button === 0) {
      leftMouseDownRef.current = true;
      chopStartTimeRef.current = performance.now();
      chopCountRef.current = 0;
      choppingPositionRef.current = null;
      
      // Start pentabullet charge if in shooting mode
      if (showCrosshairs && !blockPlacementMode && !treePlacementMode) {
        pentabulletChargeStartRef.current = performance.now();
      }
    }
  }, [showCrosshairs, blockPlacementMode, treePlacementMode]);
  
  handleMouseDownRef.current = handleMouseDown;

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (event.button === 2) {
      keys.current.rightMouse = false;
      setHoveredBlockId(null);
    }
    if (event.button === 0) {
      // Check for pentabullet release
      if (pentabulletChargeRef.current >= 5.0 && showCrosshairs) {
        firePentabullet();
      } else if (pentabulletPhaseRef.current !== 'idle') {
        // Incomplete charge - cancel and fire normal shot
        cancelPentabulletCharge();
      }
      
      leftMouseDownRef.current = false;
      chopCountRef.current = 0;
      choppingPositionRef.current = null;
      pentabulletChargeStartRef.current = null;
      // Reset progress when releasing
      onTreeChopProgress?.(0, CHOPS_REQUIRED);
    }
  }, [setHoveredBlockId, onTreeChopProgress, showCrosshairs, firePentabullet, cancelPentabulletCharge]);
  
  handleMouseUpRef.current = handleMouseUp;

  const handlePointerLockChange = useCallback(() => {
    isLocked.current = document.pointerLockElement === gl.domElement;
    // Cancel pentabullet if pointer lock is lost
    if (!isLocked.current && pentabulletPhaseRef.current !== 'idle') {
      cancelPentabulletCharge();
    }
  }, [gl, cancelPentabulletCharge]);
  
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
  
  // Pentabullet refs
  const onPentabulletChargeChangeRef = useRef(onPentabulletChargeChange);
  const showCrosshairsRef = useRef(showCrosshairs);
  
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
  useEffect(() => { onPentabulletChargeChangeRef.current = onPentabulletChargeChange; }, [onPentabulletChargeChange]);
  useEffect(() => { showCrosshairsRef.current = showCrosshairs; }, [showCrosshairs]);

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
      if (leftMouseDownRef.current && !showCrosshairs && isOwnedTreeAtPositionRef.current) {
        // Raycast to find what we're looking at
        const meshesArray = meshesArrayCache.current;
        if (meshesArray.length > 0) {
          const result = raycastMeshes(meshesArray, 15);
          
          if (result && result.instanceId !== undefined) {
            const blockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);
            
            // Check if it's any tree block type (handles encoded types like 'trunk_-1_5')
            if (blockType && isTreeBlockType(blockType)) {
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
                }
                
                const timeSinceLastChop = now - lastChopSoundTimeRef.current;
                
                // Check if enough time passed for next chop
                if (timeSinceLastChop >= CHOP_INTERVAL_MS) {
                  lastChopSoundTimeRef.current = now;
                  chopCountRef.current++;
                  
                  // Play chop sound
                  if (axeChopAudioRef.current) {
                    axeChopAudioRef.current.currentTime = 0;
                    axeChopAudioRef.current.play().catch(() => {});
                  }
                  
                  // Report progress
                  if (onTreeChopProgressRef.current) {
                    onTreeChopProgressRef.current(chopCountRef.current, CHOPS_REQUIRED);
                  }
                  
                  // Check if we've reached the required chops
                  if (chopCountRef.current >= CHOPS_REQUIRED) {
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
      
      // Pentabullet charging logic (only in shooting mode with mouse held)
      if (leftMouseDownRef.current && showCrosshairsRef.current && pentabulletChargeStartRef.current) {
        const chargeTime = (now - pentabulletChargeStartRef.current) / 1000;
        pentabulletChargeRef.current = chargeTime;
        
        // Update charge UI
        onPentabulletChargeChangeRef.current?.(chargeTime);
        
        // At 1 second, start powerup sound (plays for ~4 seconds)
        if (chargeTime >= 1.0 && pentabulletPhaseRef.current === 'idle') {
          pentabulletPhaseRef.current = 'powerup';
          pentabulletPowerupAudioRef.current = new Audio('/pentabullet_powerup.mp3');
          pentabulletPowerupAudioRef.current.volume = 0.5;
          pentabulletPowerupAudioRef.current.play().catch(() => {});
        }
        
        // At 5 seconds, switch to steady sound (looping)
        if (chargeTime >= 5.0 && pentabulletPhaseRef.current === 'powerup') {
          pentabulletPhaseRef.current = 'steady';
          // Stop powerup
          if (pentabulletPowerupAudioRef.current) {
            pentabulletPowerupAudioRef.current.pause();
          }
          // Start steady (looping)
          pentabulletSteadyAudioRef.current = new Audio('/pentabullet_power_steady.mp3');
          pentabulletSteadyAudioRef.current.volume = 0.5;
          pentabulletSteadyAudioRef.current.loop = true;
          pentabulletSteadyAudioRef.current.play().catch(() => {});
        }
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
      // Use clamped delta for movement to prevent tunneling
      const moveDt = Math.min(delta, 1/30);
      deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * moveDt);
      deltaMovement.addScaledVector(right, direction.current.x * runSpeed * moveDt);
      
      // Apply knockback velocity (decays over time)
      if (knockbackVelRef.current.lengthSq() > 0.0001) {
        deltaMovement.x += knockbackVelRef.current.x * moveDt;
        deltaMovement.z += knockbackVelRef.current.z * moveDt;
        
        // Fast decay (knockback dissipates in ~0.2 seconds)
        knockbackVelRef.current.multiplyScalar(Math.pow(0.05, moveDt));
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
      // Delta clamping to prevent tunneling during FPS drops
      const MAX_PHYSICS_DELTA = 1 / 30;
      const dt = Math.min(delta, MAX_PHYSICS_DELTA);
      const SURFACE_EPS = 0.002;
      
      // Gliding: press G while falling to activate, auto-deactivates on landing
      // Only glide if active AND still falling (not on ground)
      const isGliding = glideActiveRef.current && velocity.current.y < 0 && !onGround.current;
      const effectiveGravity = isGliding ? 4.9 : 9.8; // Half gravity when gliding
      
      // Auto-deactivate glide when landing (on ground or positive velocity = hit something)
      if (glideActiveRef.current && (onGround.current || velocity.current.y >= 0)) {
        glideActiveRef.current = false;
      }
      
      // Gravity and jumping
      velocity.current.y -= effectiveGravity * dt;

      // Player dimensions
      const playerRadius = 0.3;
      const isCrawling = keys.current.ctrl;
      const standingHeight = 1.6;
      const crawlingHeight = 0.8;
      const playerHeight = isCrawling ? crawlingHeight : standingHeight;
      const heightDiff = standingHeight - crawlingHeight; // 0.8m

      // Handle crouch transition - keep FEET position constant, move camera (head)
      if (isCrawling !== wasCrawlingRef.current) {
        if (isCrawling) {
          // Transitioning TO crawl: lower camera to keep feet in place
          camera.position.y -= heightDiff;
          wasCrawlingRef.current = true;
        } else {
          // Transitioning FROM crawl to standing: need to check for ceiling clearance
          const testStandY = camera.position.y + heightDiff;
          const testPlayerBox = createPlayerBox(
            testPosRef.current.set(camera.position.x, testStandY, camera.position.z),
            playerRadius,
            standingHeight
          );
          
          // Check for ceiling collision
          let canStandUp = true;
          const nearbyCount = collisionGrid.getNearbyFiltered(
            camera.position.x,
            camera.position.z,
            2.0,
            camera.position.y - crawlingHeight,
            testStandY + 1.0
          );
          const nearbyColliders = collisionGrid.nearbyResult;
          for (let i = 0; i < nearbyCount; i++) {
            if (testPlayerBox.intersectsBox(nearbyColliders[i])) {
              canStandUp = false;
              break;
            }
          }
          
          if (canStandUp) {
            camera.position.y += heightDiff;
            wasCrawlingRef.current = false;
          } else {
            // Can't stand up - force crawling state to remain, DON'T update ref
            keys.current.ctrl = true;
            // wasCrawlingRef stays true, preventing re-check next frame
          }
        }
      }

      // Step up height is used both for movement and for collision candidate Y range.
      const stepUpHeight = 0.6;

      // Build collision candidates once for this frame.
      // We include a vertical pad for jump arcs and step up checks.
      const candidateMinY = camera.position.y - playerHeight - 2.0;
      const candidateMaxY = camera.position.y + stepUpHeight + 2.0;

      diagnostics.e1++;
      const candidateCount = collisionGrid.getNearbyFiltered(
        camera.position.x,
        camera.position.z,
        2.0,
        candidateMinY,
        candidateMaxY
      );

      const currentColliders = collidersRef.current;
      currentColliders.length = candidateCount;
      const nearby = collisionGrid.nearbyResult;
      for (let i = 0; i < candidateCount; i++) {
        currentColliders[i] = nearby[i];
      }

      /**
       * CONTINUOUS OVERLAP RESOLUTION
       * IMPORTANT: Must run BEFORE prevPosition snapshot, otherwise later collision resolution
       * will revert us back into the overlap and cause jitter/flashing.
       * This is the key fix for wall-jump flashing.
       */
      for (let i = 0; i < 2; i++) {
        // Stage 2: Use shrunk player volume to prevent overlap trigger when just touching
        const overlap = checkAxisCollisionFromCandidates(
          camera.position,
          currentColliders,
          candidateCount,
          playerRadius * 0.8,
          playerHeight * 0.9,
          'overlap',
          undefined,
          onGround.current,
          velocity.current.y,
          false,
          true,
          true
        );

        if (!overlap) break;

        diagnostics.e6++;

        const push = findPushOutDirection(camera.position, playerRadius, playerHeight, overlap);
        if (!push) break;

        if (push.axis === 'x') {
          camera.position.x = push.direction === -1
            ? overlap.min.x - playerRadius - SURFACE_EPS
            : overlap.max.x + playerRadius + SURFACE_EPS;
          velocity.current.x = 0;
        } else if (push.axis === 'z') {
          camera.position.z = push.direction === -1
            ? overlap.min.z - playerRadius - SURFACE_EPS
            : overlap.max.z + playerRadius + SURFACE_EPS;
          velocity.current.z = 0;
        } else {
          if (push.direction === 1) {
            camera.position.y = overlap.max.y + playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            camera.position.y = overlap.min.y - SURFACE_EPS;
            velocity.current.y = 0;
          }
        }
      }

      // NOW snapshot previous position for axis-by-axis collision resolution
      // This MUST be after push-out to prevent reverting into blocks
      prevPositionRef.current.copy(camera.position);
      let xBlocked = false;
      let zBlocked = false;
      
      // Minecraft-like: jump only when grounded (continuous push-out handles overlap escape)
      const canJump = onGround.current && !keys.current.ctrl;
      const roles = userRolesRef.current;
      
      if (keys.current.space && canJump) {
        let jumpHeight = 1.25;
        if (roles.includes('admin') || roles.includes('superadmin')) {
          jumpHeight = 2.5;
        }
        velocity.current.y = Math.sqrt(2 * 9.8 * jumpHeight);
        onGround.current = false;
      }
      // Use moveDt for vertical integration (consistent timestep)
      deltaMovement.y += velocity.current.y * moveDt;

      // X-axis collision - use axis-aware intersection
      if (deltaMovement.x !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.x += deltaMovement.x;
        
        if (checkAxisCollisionFromCandidates(testPosRef.current, currentColliders, candidateCount, playerRadius, playerHeight, 'x', undefined, onGround.current, velocity.current.y)) {
          camera.position.x = prevPositionRef.current.x;
          velocity.current.x = 0;
          xBlocked = true;
        } else {
          camera.position.x = testPosRef.current.x;
        }
      }

      // Z-axis collision - use axis-aware intersection
      if (deltaMovement.z !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.z += deltaMovement.z;
        
        if (checkAxisCollisionFromCandidates(testPosRef.current, currentColliders, candidateCount, playerRadius, playerHeight, 'z', undefined, onGround.current, velocity.current.y)) {
          camera.position.z = prevPositionRef.current.z;
          velocity.current.z = 0;
          zBlocked = true;
        } else {
          camera.position.z = testPosRef.current.z;
        }
      }

      // Y-axis collision - use directional collision detection
      if (deltaMovement.y !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.y += deltaMovement.y;
        
        // Pass direction: 1 = moving up (find ceiling), -1 = moving down (find floor)
        const yDirection: 1 | -1 = deltaMovement.y > 0 ? 1 : -1;
        const collision = checkAxisCollisionFromCandidates(testPosRef.current, currentColliders, candidateCount, playerRadius, playerHeight, 'y', yDirection, onGround.current, velocity.current.y);
        
        if (collision) {
          if (yDirection < 0) {
            // Falling DOWN - land on top of block (use collision.max.y = floor surface)
            camera.position.y = collision.max.y + playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            // Jumping UP - hit ceiling (use collision.min.y = ceiling surface)
            camera.position.y = collision.min.y - SURFACE_EPS;
            velocity.current.y = 0;
          }
        } else {
          if (testPosRef.current.y < playerHeight && velocity.current.y < 0) {
            camera.position.y = playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
            onGround.current = true;
          } else {
            camera.position.y = testPosRef.current.y;
            onGround.current = false;
          }
        }
      }

      // Step-up mechanic (stepUpHeight already declared above)
      const isMovingHorizontally = Math.abs(deltaMovementRef.current.x) > 0.001 || Math.abs(deltaMovementRef.current.z) > 0.001;
      
      if ((xBlocked || zBlocked) && onGround.current && isMovingHorizontally) {
        // Use candidate-based step up with camera.position (not camera)
        const stepUpY = findStepUpTargetFromCandidates(
          camera.position,
          currentColliders,
          candidateCount,
          playerRadius,
          playerHeight
        );
        
        if (stepUpY !== null) {
          camera.position.y = stepUpY + playerHeight + SURFACE_EPS;
          velocity.current.y = 0;
          onGround.current = true;
        }
      }
      
      // Ground detection (robust): test a small downward move using the SAME player box convention
      const needsGroundCheck = !onGround.current || velocity.current.y < -0.1;
      if (needsGroundCheck) {
        const GROUND_SNAP_DIST = 0.08;

        feetCheckPosRef.current.copy(camera.position);
        feetCheckPosRef.current.y = camera.position.y - GROUND_SNAP_DIST;

        const groundHit = checkAxisCollisionFromCandidates(
          feetCheckPosRef.current,
          currentColliders,
          candidateCount,
          playerRadius,
          playerHeight,
          'y',
          -1,
          onGround.current,
          velocity.current.y
        );

        const feetY = camera.position.y - playerHeight;
        const onWorldGround = feetY <= (SURFACE_EPS + 0.01);

        if ((groundHit && velocity.current.y <= 0.05) || onWorldGround) {
          if (groundHit && velocity.current.y < 0) {
            camera.position.y = groundHit.max.y + playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
          } else if (onWorldGround && velocity.current.y < 0) {
            camera.position.y = playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
          }
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
