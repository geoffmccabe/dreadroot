import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import * as THREE from 'three';
import { useRaycaster } from '@/hooks/useRaycaster';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { PlacedBlock } from '@/types/blocks';
import { playSpatialSound, preloadSpatialSounds, play3DPositionalSound } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
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
import { worldCollisionGrid, entityCollisionGrid } from '@/lib/spatialHashGrid';
import { isTreeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { playerTracker } from '@/lib/playerTracker';
import { setGlobalInspectData, clearGlobalInspectData, toggleInspectorMode, setInspectorMode, inspectorModeEnabled, globalInspectData, type GlobalInspectData, type InspectSources } from '@/components/FPSCounter';
import { blockDB } from '@/hooks/useIndexedDB';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { type WaterType } from '@/lib/pondGenerator';
import { isPointInNoFireZone } from '@/features/enemies/ai/fortressSafeZone';
import { playPinPullSound } from '@/features/grenades/lib/explosionSound';

// Pre-allocated scratch objects for inspector/raycast (avoid per-frame GC)
const _inspectorMatrix = new THREE.Matrix4();
const _inspectorPos = new THREE.Vector3();
const _inspectorDir = new THREE.Vector3();
const _inspectorDistVec = new THREE.Vector3();

export function FirstPersonControls({
  onShoot,
  showCrosshairs,
  audioRefs,
  playAudio,
  blockPlacementMode,
  treePlacementMode,
  fungalPlacementMode,
  widePlacementMode,
  onBlockPlace,
  onTreePlace,
  onFungalTreePlace,
  onWideTreePlace,
  onOpenPanel,
  onOpenMarketplace,
  onOpenGodMap,
  onToggleInventory,
  onModeChange,
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
  respawnPosition,
  onRespawnComplete,
  isOwnedTreeAtPosition,
  onTreeChopComplete,
  onTreeChopProgress,
  onBlockMineComplete,
  onBulletTierChange,
  // Pentabullet props
  playerLevel = 1,
  onPentabulletChargeChange,
  // Hotbar quick-use (digit 1-6 activates the equipped slot's item)
  onUseHotbarSlot,
  // Grenade throw — called on click while grenade-ready. Returns true
  // if a grenade was actually thrown (false if inventory empty etc.).
  onThrowGrenade,
  // G key handler — parent decides whether to arm (and which slot)
  // based on inventory + equipped state. Returns whether arming
  // happened (controls don't care, the parent will reflect state
  // via grenadeReady prop).
  onGrenadeTogglePress,
  // True while a grenade is pin-pulled and waiting for a throw click.
  // Owned by parent. The click handler reads this to know whether
  // to throw instead of fire the equipped weapon.
  grenadeReady: grenadeReadyProp = false,
  // Shpider Egg throw (Y key + click) — same shape as grenade.
  onThrowEgg,
  onEggTogglePress,
  eggReady: eggReadyProp = false,
  // H key handler — parent drinks a potion (auto-equips if needed).
  onHealthPotionUse,
  // Admin/superadmin item grants — Cmd+G grenade, Cmd+H health potion.
  onAdminGrantGrenade,
  onAdminGrantHealthPotion,
  // Vault — V key opens it, only fires when caller passes a handler
  // (Fortress.tsx gates this by proximity to the back wall).
  onOpenVault,
  // Admin spawn shortcut
  onSpawnShnake,
  // Jet Boost system
  onJetBoostStateChange,
  onJetBoostFired,
  bulletTier = 1,
  // Walapa riding system
  walapasRef,
  // Flame Glove system
  isFlameGloveSelected,
  onFlameStart,
  onFlameStop,
  // Fruit harvest system (F-key)
  onHarvestFruit,
  // Swimming system
  checkIsInWater,
  getWaterType,
  onSwimmingStateChange,
  onLavaDamage,
  // Block Inspector
  loadedChunksRef,
  currentWorldId,
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
    q: false, z: false, e: false
  });
  // Glide mode: activated by pressing G while falling, auto-deactivates on landing
  const glideActiveRef = useRef(false);

  // Grenade ready state mirror — synced from parent prop so the
  // click handler can read it without async state. Parent (Fortress)
  // owns the actual flag because it depends on inventory + equipped
  // slot lookups.
  const grenadeReadyRef = useRef(false);
  useEffect(() => { grenadeReadyRef.current = grenadeReadyProp; }, [grenadeReadyProp]);
  const eggReadyRef = useRef(false);
  useEffect(() => { eggReadyRef.current = eggReadyProp; }, [eggReadyProp]);

  // Jet Boost system: 1 boost per 3 levels, recharges every 60 seconds
  const jetBoostMaxRef = useRef(0);
  const jetBoostAvailRef = useRef(0);
  const jetBoostNextRefillRef = useRef(0);
  const jetBoostRequestRef = useRef(false);
  const spaceKeyEdgeRef = useRef(false); // Edge detection for space key
  const lastJetBoostStateUpdateRef = useRef(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  
  // R-mode for bullet tier selection (admin only) - press R, then 1-0 to select tier
  const rModeActiveRef = useRef(false);
  const rModeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // T-mode for fungal tree selection - press T, then 3 within 3 seconds
  const tModeActiveRef = useRef(false);
  const tModeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // God Mode state (fly + noclip for admins/superadmins)
  const godModeRef = useRef(false);
  const [godModeEnabled, setGodModeEnabled] = useState(false);
  const onGround = useRef(true);
  const yaw = useRef(Math.PI); // Start facing outward (180 degrees)
  const pitch = useRef(0);
  const lastGroundCheck = useRef(0);
  const stuckTimer = useRef(0);
  const lastPositionLog = useRef(0);

  // Swimming state
  const isInWaterRef = useRef(false);
  const waterTypeRef = useRef<WaterType | null>(null);
  const lastSwimmingStateRef = useRef(false); // For detecting state changes
  const lastLavaDamageTimeRef = useRef(0); // For lava damage timing (500ms ticks)
  
  // Knockback velocity for shwarm hits (decays over time)
  const knockbackVelRef = useRef(new THREE.Vector3());

  // Moving platform (walapa riding) tracking
  const currentWalapaIdRef = useRef<string | null>(null);
  const walapaLastPosRef = useRef(new THREE.Vector3());
  const walapaDeltaRef = useRef(new THREE.Vector3());

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
  const playerDirectionRef = useRef(new THREE.Vector3()); // For player tracker
  
  // Throttle ref for hover detection (avoid per-frame setState!)
  const lastHoverCheckRef = useRef(0);

  // Throttle ref for inspector mode raycasting (every 50ms = 20Hz)
  const lastInspectorCheckRef = useRef(0);
  const lastInspectorPosRef = useRef({ x: -9999, y: -9999, z: -9999 });

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
  // axeChopAudioRef removed - now using playSpatialSound for reliable audio
  
  // Pentabullet charging state
  const pentabulletChargeStartRef = useRef<number | null>(null);
  const pentabulletChargeRef = useRef(0);
  const pentabulletPowerupAudioRef = useRef<HTMLAudioElement | null>(null);
  const pentabulletSteadyAudioRef = useRef<HTMLAudioElement | null>(null);
  const pentabulletPhaseRef = useRef<'idle' | 'powerup' | 'steady'>('idle');
  const playerLevelRef = useRef(playerLevel);
  
  // Legacy spawn mode removed - now handled by useSpawnCommands hook
  
  // Track previous crawl state for crouch height transition
  const wasCrawlingRef = useRef(false);
  
  // Preload axe chop sound via spatial audio system
  useEffect(() => {
    preloadSpatialSounds([getSoundUrl('axe_chop', '/axe_chop.mp3')]);
  }, []);

  // Preload gunshot, pentabullet, and jet boost sounds via spatial audio system (works reliably)
  useEffect(() => {
    preloadSpatialSounds([
      getSoundUrl('gunshot', '/space_gunshot.mp3'),
      getSoundUrl('pentabullet_fire', '/pentabullet_sound.mp3'),
      getSoundUrl('pentabullet_powerup', '/pentabullet_powerup.mp3'),
      getSoundUrl('pentabullet_charging', '/pentabullet_power_steady.mp3'),
      getSoundUrl('pentabullet_powerdown', '/pentabullet_powerdown.mp3'),
      getSoundUrl('pistol_cock', '/pistol_cocking_sound.mp3'),
      getSoundUrl('pistol_holster', '/holster_pistol_sound.mp3'),
      getSoundUrl('jet_boots', '/jet_boots_1.mp3'),
      // Preload grenade explosion + pin-pull. Without preload the
      // first throw fetches/decodes the MP3 on demand and the SFX
      // lag noticeably behind the action.
      '/grenade_explosion.mp3',
      '/grenade-pin-pull.mp3',
    ]);
  }, []);

  // Preload pentabullet charging sounds (looping sounds need HTMLAudioElement for pause/play)
  useEffect(() => {
    // Preload powerup sound with explicit load
    const powerup = new Audio(getSoundUrl('pentabullet_powerup', '/pentabullet_powerup.mp3'));
    powerup.volume = 0.5;
    powerup.preload = 'auto';
    powerup.load(); // Force preload
    pentabulletPowerupAudioRef.current = powerup;

    // Preload steady sound with explicit load
    const steady = new Audio(getSoundUrl('pentabullet_charging', '/pentabullet_power_steady.mp3'));
    steady.volume = 0.5;
    steady.loop = true;
    steady.preload = 'auto';
    steady.load(); // Force preload
    pentabulletSteadyAudioRef.current = steady;
  }, []);
  
  // Keep player level ref updated
  useEffect(() => {
    console.log(`[FortressControls] playerLevel prop updated to: ${playerLevel}`);
    playerLevelRef.current = playerLevel;
  }, [playerLevel]);

  const gridInitialized = useRef(false);
  
  // Apply knockback function - can be called externally via prop or internally
  // IMPORTANT: Only applies horizontal knockback (X/Z) - vertical is ignored to prevent sky launches
  const applyKnockback = useCallback((direction: THREE.Vector3, distance: number) => {
    // Calculate velocity needed to travel 'distance' over ~0.2 seconds
    const secondsToApply = 0.2;
    // Only apply horizontal knockback - set Y to 0 to prevent accumulation
    knockbackVelRef.current.x += direction.x * (distance / secondsToApply);
    knockbackVelRef.current.z += direction.z * (distance / secondsToApply);
    // Explicitly keep Y at 0 - no vertical knockback
    knockbackVelRef.current.y = 0;
  }, []);
  
  // Expose applyKnockback globally for the universal damage system
  // This is always set - the damage pipeline in usePlayerHealth uses it
  useEffect(() => {
    (window as any).__applyPlayerKnockback = applyKnockback;
    return () => {
      delete (window as any).__applyPlayerKnockback;
    };
  }, [applyKnockback]);
  
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
        // Ctrl+I toggles Inspector Mode (admin only)
        if (event.ctrlKey) {
          console.log('[FortressControls] Ctrl+I pressed, userRoles:', userRoles);
          if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
            event.preventDefault();
            console.log('[FortressControls] Toggling inspector mode');
            toggleInspectorMode();
            break;
          }
        }
        // Regular I opens inventory
        event.preventDefault();
        onToggleInventory?.();
        break;
      case 'KeyY':
        // Ctrl+Y plays yodel if player is at Y>=50
        // Uses 3D positional audio so other players can hear direction
        if (event.ctrlKey && camera.position.y >= 50) {
          event.preventDefault();
          const yodelPosition = camera.position.clone();
          const cameraDirection = new THREE.Vector3();
          camera.getWorldDirection(cameraDirection);
          play3DPositionalSound(
            getSoundUrl('yodel', '/yodel_1.mp3'),
            yodelPosition,
            camera.position,
            cameraDirection,
            { baseVolume: 0.8 }
          );
          // TODO: Broadcast yodel position to other players via multiplayer system
          break;
        }
        // Plain Y: arm a shpider egg (parent handles find/auto-equip).
        if (event.repeat) break;
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        if (onEggTogglePress) onEggTogglePress();
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
        // Edge detection for jet boost (only on initial press, not repeat)
        if (!event.repeat) {
          spaceKeyEdgeRef.current = true;
        }
        event.preventDefault();
        break;
      case 'ControlLeft':
        keys.current.ctrl = true;
        break;
      case 'KeyR':
        // R toggles gun on/off regardless of shift/movement state
        if (!blockPlacementMode) {
          const newCrosshairsState = !showCrosshairs;
          onModeChange(newCrosshairsState ? 'shooting' : null);
          const soundUrl = newCrosshairsState
            ? getSoundUrl('pistol_cock', '/pistol_cocking_sound.mp3')
            : getSoundUrl('pistol_holster', '/holster_pistol_sound.mp3');
          playSpatialSound(soundUrl, 0, { baseVolume: 0.5 });

          // For admins: activate R-mode for bullet tier selection (2 second window)
          if (newCrosshairsState && (userRoles.includes('admin') || userRoles.includes('superadmin')) && onBulletTierChange) {
            rModeActiveRef.current = true;
            if (rModeTimeoutRef.current) clearTimeout(rModeTimeoutRef.current);
            rModeTimeoutRef.current = setTimeout(() => {
              rModeActiveRef.current = false;
            }, 2000);
          }
        } else {
          // In block placement mode, R still activates shooting
          onModeChange('shooting');
          playSpatialSound(getSoundUrl('pistol_cock', '/pistol_cocking_sound.mp3'), 0, { baseVolume: 0.5 });

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
      // Also handles spawn mode stage 2 (!2#)
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
        // Legacy spawn mode removed - now handled by useSpawnCommands hook in FortressScene

        // T-mode: T+2 for wide tree planting
        if (tModeActiveRef.current && event.code === 'Digit2') {
          console.log('[KeyHandler] T+2 detected, switching to wide_planting');
          event.preventDefault();
          tModeActiveRef.current = false;
          if (tModeTimeoutRef.current) {
            clearTimeout(tModeTimeoutRef.current);
            tModeTimeoutRef.current = null;
          }
          onModeChange('wide_planting');
          break;
        }

        // T-mode: T+3 for fungal tree planting
        if (tModeActiveRef.current && event.code === 'Digit3') {
          console.log('[KeyHandler] T+3 detected, switching to fungal_planting');
          event.preventDefault();
          tModeActiveRef.current = false;
          if (tModeTimeoutRef.current) {
            clearTimeout(tModeTimeoutRef.current);
            tModeTimeoutRef.current = null;
          }
          // Switch from tree planting to fungal planting
          onModeChange('fungal_planting');
          break;
        }

        // R-mode for bullet tier selection
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
          break;
        }
        // Default: digits 1-6 activate the corresponding hotbar slot
        // (consume the equipped item — used for health potions etc.).
        // Skipped while in any placement / spawn mode so number keys
        // still mean what they used to in those flows.
        if (onUseHotbarSlot && event.code >= 'Digit1' && event.code <= 'Digit6') {
          const slot = parseInt(event.code.replace('Digit', ''));
          event.preventDefault();
          onUseHotbarSlot(slot);
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
        if (treePlacementMode || fungalPlacementMode || widePlacementMode) {
          onModeChange(null);
        } else {
          onModeChange('planting');
          // Start T-mode: 3 second window for T+2 wide / T+3 fungal combo
          tModeActiveRef.current = true;
          if (tModeTimeoutRef.current) clearTimeout(tModeTimeoutRef.current);
          tModeTimeoutRef.current = setTimeout(() => {
            tModeActiveRef.current = false;
          }, 3000);
        }
        break;
      case 'KeyO':
        event.preventDefault();
        onOpenPanel('market');
        break;
      case 'KeyM':
        event.preventDefault();
        // Cmd/Ctrl+M opens the God Map (admin map view). Plain M still
        // opens the marketplace.
        if (event.metaKey || event.ctrlKey) {
          onOpenGodMap?.();
        } else {
          onOpenMarketplace?.();
        }
        break;
      case 'BracketLeft':
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('prev');
        } else if (treePlacementMode) {
          event.preventDefault();
          onCycleSeed('prev');
        } else if (fungalPlacementMode) {
          event.preventDefault();
          onCycleFungalSeed('prev');
        } else if (widePlacementMode) {
          event.preventDefault();
          onCycleWideSeed('prev');
        }
        break;
      case 'BracketRight':
        if (blockPlacementMode) {
          event.preventDefault();
          onCycleBlock('next');
        } else if (treePlacementMode) {
          event.preventDefault();
          onCycleSeed('next');
        } else if (fungalPlacementMode) {
          event.preventDefault();
          onCycleFungalSeed('next');
        } else if (widePlacementMode) {
          event.preventDefault();
          onCycleWideSeed('next');
        }
        break;
      case 'Escape':
        // Exit Inspector Mode if active
        if (inspectorModeEnabled) {
          setInspectorMode(false);
          break;
        }
        if (isLocked.current) {
          document.exitPointerLock();
        }
        break;
      case 'Backquote': // ` or ~ key for God Mode
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
          console.log(`[Debug] World Colliders: ${worldCollisionGrid.size}, Entity Colliders: ${entityCollisionGrid.size}`);
          (worldCollisionGrid as any).debugNearby?.(camera.position.x, camera.position.z, 5);
        }
        break;
      case 'F10': // Emergency: clear entire collision grid and rebuild
      case 'Digit0': // Also 0 key (with Shift) - Mac-friendly alternative: Shift+0
        if (event.repeat) break; // Ignore key repeat
        if (event.code === 'Digit0' && !event.shiftKey) break; // Only Shift+0 triggers clear
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          event.preventDefault();
          console.warn('[ADMIN] collision grid clear invoked', { code: event.code });
          const oldWorldSize = worldCollisionGrid.size;
          const oldEntitySize = entityCollisionGrid.size;
          console.log('[Debug] EMERGENCY: Clearing both collision grids!');
          worldCollisionGrid.clear();
          entityCollisionGrid.clear();

          // Immediately reinsert fortress colliders (block colliders are reinserted by the chunk loader listener).
          resetFortressGridState();
          createFortressColliders();

          const newWorldSize = worldCollisionGrid.size;
          console.log(`[Debug] Grids cleared. World was ${oldWorldSize}, now ${newWorldSize}. Entity was ${oldEntitySize}, now 0.`);
          
          // Show toast so user knows it worked
          alert(`Collision grids cleared! World: ${oldWorldSize} → ${newWorldSize}, Entity: ${oldEntitySize} → 0`);
        }
        break;
      case 'KeyQ':
        keys.current.q = true;
        break;
      case 'KeyZ':
        keys.current.z = true;
        break;
      case 'KeyG':
        // Cmd+G / Ctrl+G (admin): grant 1 grenade. event.repeat guard
        // prevents OS auto-repeat (30Hz) from minting 15 grenades on
        // a held key.
        if (event.repeat) break;
        if ((event.metaKey || event.ctrlKey) && onAdminGrantGrenade) {
          event.preventDefault();
          void onAdminGrantGrenade();
          break;
        }
        // Plain G: glide if mid-air falling, else delegate to parent
        // for the "find/auto-equip/arm grenade" logic (parent owns
        // inventory + equipped state, so it decides whether G is
        // valid AND which slot to arm).
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        if (!onGround.current && velocity.current.y < 0) {
          glideActiveRef.current = true;
        } else if (onGrenadeTogglePress) {
          onGrenadeTogglePress();
        }
        break;
      case 'KeyH':
        // Cmd+H / Ctrl+H (admin): grant 1 health potion. Plain H:
        // drink a potion (parent handles auto-equip + slot selection,
        // same flow as G for grenades).
        if (event.repeat) break;
        if ((event.metaKey || event.ctrlKey) && onAdminGrantHealthPotion
            && (userRoles.includes('admin') || userRoles.includes('superadmin'))) {
          event.preventDefault();
          void onAdminGrantHealthPotion();
          break;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        if (onHealthPotionUse) onHealthPotionUse();
        break;
      case 'KeyE':
        keys.current.e = true;
        break;
      case 'KeyF':
        // Harvest nearest fruit
        if (onHarvestFruitRef.current) {
          onHarvestFruitRef.current();
        }
        break;
      case 'KeyV':
        // Open vault if the player is near the fortress back-wall.
        // No modifier — Cmd/Ctrl+V is left alone (browser paste).
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        if (onOpenVault) {
          event.preventDefault();
          onOpenVault();
        }
        break;
    }
  }, [crosshairsEnabled, onModeChange, onOpenPanel, onOpenMarketplace, onOpenGodMap, onToggleInventory, getBlockQuantity, selectedBlockType, panelOpen, blockPlacementMode, showCrosshairs, audioRefs, playAudio, onBlockRain, onCycleBlock, userRoles, onGodModeChange, onAdminGrantGrenade, onAdminGrantHealthPotion, onOpenVault]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Process key releases unconditionally — gating these on panelOpen
    // / focused inputs would leave movement booleans (ctrl, shift, w/a/
    // s/d, …) stuck on TRUE if a panel opens while a key is held. The
    // worst symptom: pressing Ctrl, opening a panel, releasing Ctrl,
    // closing the panel — the player would then be stuck crouched.
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
      case 'KeyE':
        keys.current.e = false;
        break;
    }
  }, [panelOpen]);

  // Euler for camera rotation
  const eulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const needsCameraUpdate = useRef(true); // Start true to apply initial rotation on first frame

  // Automated perf-test control surface (test-only; gated on ?perftest — no
  // production effect). Lets scripts/perftest.ts drive the camera headlessly.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perftest')) {
    (window as any).__perfTestControls = {
      setYaw: (v: number) => { yaw.current = v; needsCameraUpdate.current = true; },
      setPitch: (v: number) => { pitch.current = v; needsCameraUpdate.current = true; },
      enableGodMode: () => { godModeRef.current = true; setGodModeEnabled(true); onGodModeChange?.(true); },
      disableGodMode: () => { godModeRef.current = false; setGodModeEnabled(false); onGodModeChange?.(false); },
      isGodMode: () => godModeRef.current,
      getPosition: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
      setPositionY: (y: number) => { camera.position.y = y; },
      setPosition: (x: number, y: number, z: number) => { camera.position.set(x, y, z); },
    };
  }
  
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
    } else if (fungalPlacementMode && onFungalTreePlace) {
      // Fungal tree placement - tree grows around the player
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
        onFungalTreePlace(position);
      }
    } else if (widePlacementMode && onWideTreePlace) {
      // Wide tree placement
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
        onWideTreePlace(position);
      }
    } else if (grenadeReadyRef.current && onThrowGrenade) {
      // Grenade-ready mode takes priority over normal weapon fire and
      // works without a weapon equipped (COD-style). Throw, clear the
      // ready flag whether it succeeded or not — a failed throw (e.g.
      // empty inventory) disarms cleanly so the user knows to press G
      // again.
      onThrowGrenade();
      grenadeReadyRef.current = false;
      onGrenadeReadyChange?.(false);
    } else if (eggReadyRef.current && onThrowEgg) {
      // Egg-ready mode same priority as grenade. Clear ref so the
      // crosshair clears even if the throw failed.
      onThrowEgg();
      eggReadyRef.current = false;
    } else if (showCrosshairs && onShoot) {
      // Flame Glove uses continuous hold, not click-to-fire
      if (isFlameGloveSelected) return;

      // Skip normal shot if pentabullet is charging (>1s hold)
      if (pentabulletChargeRef.current >= 1.0) {
        return; // Will fire pentabullet or cancel on mouseup
      }

      // Check if player is in no-fire zone (FSZ + 1 chunk buffer)
      if (isPointInNoFireZone(camera.position.x, camera.position.y, camera.position.z)) {
        // Play empty gun click sound instead of shooting
        playSpatialSound(getSoundUrl('empty_gun_click', '/empty_gun_click.mp3'), 0, { baseVolume: 0.5 });
        return;
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

      // Play gunshot sound via spatial audio (works reliably, distance 0 = full volume)
      playSpatialSound(getSoundUrl('gunshot', '/space_gunshot.mp3'), 0, { baseVolume: 0.3 });
    }
  }, [gl, showCrosshairs, onShoot, camera, blockPlacementMode, treePlacementMode, fungalPlacementMode, widePlacementMode, onBlockPlace, onTreePlace, onFungalTreePlace, onWideTreePlace, existingBlocks, selectedBlockType, showOwnershipOutline, hoveredBlockId, onBlockRemove, setHoveredBlockId]);
  
  handleClickRef.current = handleClick;

  // Cancel pentabullet charge helper
  const cancelPentabulletCharge = useCallback(() => {
    if (pentabulletPhaseRef.current !== 'idle') {
      // Play powerdown sound via spatial audio
      playSpatialSound(getSoundUrl('pentabullet_powerdown', '/pentabullet_powerdown.mp3'), 0, { baseVolume: 0.5 });

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
  
  // Fire pentabullet - base 10 bullets (2 rounds of 5), +5 bullets every 6 levels
  // Sound file has 5 shots, so it plays once per round with no gap between sounds
  // Calculate spread direction for a single bullet (first bullet true, others have spread)
  const calculateSpreadDirection = useCallback((isFirstInRound: boolean): THREE.Vector3 => {
    // Get current camera direction at fire time
    const baseDirection = new THREE.Vector3(0, 0, -1);
    baseDirection.applyQuaternion(camera.quaternion);
    baseDirection.normalize();

    // First bullet fires true (straight)
    if (isFirstInRound) {
      return baseDirection;
    }

    // Apply spread to non-first bullets
    const spreadAngle = Math.max(0.005, 0.05 - (playerLevelRef.current * 0.001));
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(baseDirection, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, baseDirection).normalize();

    const dir = baseDirection.clone();
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * spreadAngle;
    dir.addScaledVector(right, Math.cos(theta) * Math.sin(phi));
    dir.addScaledVector(realUp, Math.sin(theta) * Math.sin(phi));
    dir.normalize();

    return dir;
  }, [camera]);

  const firePentabullet = useCallback(() => {
    if (!onShoot) return;

    // Check if player is in no-fire zone (FSZ + 1 chunk buffer)
    if (isPointInNoFireZone(camera.position.x, camera.position.y, camera.position.z)) {
      // Play empty gun click sound and cancel the charge
      playSpatialSound(getSoundUrl('empty_gun_click', '/empty_gun_click.mp3'), 0, { baseVolume: 0.5 });
      cancelPentabulletCharge();
      return;
    }

    // Stop charging sounds
    if (pentabulletPowerupAudioRef.current) {
      pentabulletPowerupAudioRef.current.pause();
      pentabulletPowerupAudioRef.current.currentTime = 0;
    }
    if (pentabulletSteadyAudioRef.current) {
      pentabulletSteadyAudioRef.current.pause();
      pentabulletSteadyAudioRef.current.currentTime = 0;
    }

    // Determine number of rounds based on player level
    // Base: 2 rounds (10 bullets), +1 round every 6 levels
    // Level 1-5: 2 rounds (10 bullets), Level 6-11: 3 rounds (15 bullets), etc.
    const playerLevel = playerLevelRef.current;
    const numRounds = 2 + Math.floor(playerLevel / 6);

    // Fire each round - 5 bullets per round, 0.1s apart = 0.5s per round
    // No gap between sounds, so roundDelay = 500ms per round
    for (let round = 0; round < numRounds; round++) {
      const roundDelay = round * 500; // 0.5 seconds between rounds (no gap - sounds play continuously)

      // Play pentabullet fire sound for each round via spatial audio
      setTimeout(() => {
        playSpatialSound(getSoundUrl('pentabullet_fire', '/pentabullet_sound.mp3'), 0, { baseVolume: 0.6 });
      }, roundDelay);

      // Fire 5 bullets 0.1 seconds apart, calculating direction at fire time
      for (let i = 0; i < 5; i++) {
        const bulletDelay = roundDelay + i * 100;
        const isFirstInRound = i === 0;

        setTimeout(() => {
          // Get current camera position and direction at fire time
          const origin = camera.position.clone();
          const direction = calculateSpreadDirection(isFirstInRound);
          onShoot(origin, direction, true); // isPentabullet = true for 3x larger/longer impacts
        }, bulletDelay);
      }
    }

    // Reset state
    pentabulletChargeStartRef.current = null;
    pentabulletChargeRef.current = 0;
    pentabulletPhaseRef.current = 'idle';
    onPentabulletChargeChange?.(0);
  }, [camera, calculateSpreadDirection, onShoot, onPentabulletChargeChange, cancelPentabulletCharge]);
  
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
    if (event.button === 2) {
      keys.current.rightMouse = true;

      // Admin block inspect: right-click to see full block info
      const isAdminUser = userRoles.includes('admin') || userRoles.includes('superadmin');
      if (isAdminUser) {
        const meshesArray = meshesArrayCache.current;
        let bx = 0, by = 0, bz = 0;
        let meshBlockType: string | undefined;
        let inMesh = false;
        let isGround = false;
        let meshName = '';
        let instanceId = -1;

        // Try raycast against placed block meshes first
        const result = meshesArray.length > 0 ? raycastMeshes(meshesArray, 20) : null;

        if (result && result.instanceId !== undefined) {
          // Hit an instanced mesh (placed block)
          inMesh = true;
          meshBlockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);
          const mesh = result.object as THREE.InstancedMesh;
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(result.instanceId, matrix);
          const pos = new THREE.Vector3();
          pos.setFromMatrixPosition(matrix);

          bx = Math.floor(pos.x);
          by = Math.floor(pos.y);
          bz = Math.floor(pos.z);
          meshName = mesh.name || '(unnamed)';
          instanceId = result.instanceId;
        } else {
          // No placed block hit - ray march along LoS checking colliders
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);

          // Ray march parameters
          const maxDistance = 20;
          const stepSize = 0.5; // Check every half-block
          let foundViaCollider = false;
          let lastCheckedX = -99999, lastCheckedY = -99999, lastCheckedZ = -99999;

          // Walk along the ray checking for colliders
          for (let dist = 1; dist < maxDistance && !foundViaCollider; dist += stepSize) {
            const checkX = Math.floor(camera.position.x + camDir.x * dist);
            const checkY = Math.floor(camera.position.y + camDir.y * dist);
            const checkZ = Math.floor(camera.position.z + camDir.z * dist);

            // Skip if we already checked this voxel (optimization)
            if (checkX === lastCheckedX && checkY === lastCheckedY && checkZ === lastCheckedZ) continue;
            lastCheckedX = checkX;
            lastCheckedY = checkY;
            lastCheckedZ = checkZ;

            // Check collision grid for a collider at this position
            const colliderCount = worldCollisionGrid.getNearbyFiltered(
              checkX + 0.5, checkZ + 0.5, 1.0, checkY, checkY + 1
            );

            if (colliderCount > 0) {
              const nearby = worldCollisionGrid.nearbyResult;
              for (let i = 0; i < colliderCount; i++) {
                const c = nearby[i];
                if (c.min.x <= checkX + 0.9 && c.max.x >= checkX + 0.1 &&
                    c.min.y <= checkY + 0.9 && c.max.y >= checkY + 0.1 &&
                    c.min.z <= checkZ + 0.9 && c.max.z >= checkZ + 0.1) {
                  // Found a collider - use this position
                  bx = checkX;
                  by = checkY;
                  bz = checkZ;
                  foundViaCollider = true;
                  meshBlockType = 'unknown (collider only)';
                  break;
                }
              }
            }
          }

          // If no collider found, check for ground intersection
          if (!foundViaCollider && camDir.y < -0.01) {
            const t = -camera.position.y / camDir.y;
            if (t > 0 && t < maxDistance) {
              bx = Math.floor(camera.position.x + camDir.x * t);
              by = 0;
              bz = Math.floor(camera.position.z + camDir.z * t);
              isGround = true;
              meshBlockType = 'grass_block';
            }
          }
        }

        // Check if we found anything (mesh, collider via ray march, or ground)
        const foundSomething = inMesh || isGround || meshBlockType !== undefined;

        if (foundSomething) {
          // Calculate LoS distance
          const losDistance = (_inspectorDistVec.set(bx + 0.5, by + 0.5, bz + 0.5), camera.position.distanceTo(_inspectorDistVec));

          // Calculate chunk key for this position
          const chunkX = Math.floor(bx / CHUNK_SIZE);
          const chunkZ = Math.floor(bz / CHUNK_SIZE);
          const chunkKey = `chunk_${chunkX}_${chunkZ}`;

          // === SOURCE: State Array ===
          const matchedInState = existingBlocks?.find((b: PlacedBlock) =>
            Math.floor(b.position_x) === bx &&
            Math.floor(b.position_y) === by &&
            Math.floor(b.position_z) === bz
          );

          // === SOURCE: Loaded Chunks (Memory) ===
          let chunksFound = false;
          let chunksBlockType: string | undefined;
          let fromVisibleBlocks = false;
          let chunkBlockCount = 0;

          if (loadedChunksRef?.current) {
            const chunkData = loadedChunksRef.current.get(chunkKey);
            if (chunkData) {
              chunkBlockCount = chunkData.blocks.length;
              // Check visibleBlocks first, then all blocks
              const inVisible = chunkData.visibleBlocks?.find(b =>
                Math.floor(b.position_x) === bx &&
                Math.floor(b.position_y) === by &&
                Math.floor(b.position_z) === bz
              );
              if (inVisible) {
                chunksFound = true;
                chunksBlockType = inVisible.block_type;
                fromVisibleBlocks = true;
              } else {
                const inBlocks = chunkData.blocks.find(b =>
                  Math.floor(b.position_x) === bx &&
                  Math.floor(b.position_y) === by &&
                  Math.floor(b.position_z) === bz
                );
                if (inBlocks) {
                  chunksFound = true;
                  chunksBlockType = inBlocks.block_type;
                }
              }
            }
          }

          // === SOURCE: Collider ===
          const colliderCount = worldCollisionGrid.getNearbyFiltered(bx + 0.5, bz + 0.5, 1.0, by, by + 1);
          let colliderFound = false;
          let colliderBounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | undefined;
          const nearby = worldCollisionGrid.nearbyResult;
          for (let i = 0; i < colliderCount; i++) {
            const c = nearby[i];
            if (c.min.x <= bx + 0.9 && c.max.x >= bx + 0.1 &&
                c.min.y <= by + 0.9 && c.max.y >= by + 0.1 &&
                c.min.z <= bz + 0.9 && c.max.z >= bz + 0.1) {
              colliderFound = true;
              colliderBounds = {
                minX: c.min.x, minY: c.min.y, minZ: c.min.z,
                maxX: c.max.x, maxY: c.max.y, maxZ: c.max.z
              };
              break;
            }
          }

          // === SOURCE: Tree Data ===
          const isTree = meshBlockType ? isTreeBlockType(meshBlockType) : false;
          let treeBaseType: string | undefined;
          let treeDepth: number | undefined;
          let treeTier: number | undefined;

          if (isTree && meshBlockType) {
            treeBaseType = getBaseTreeBlockType(meshBlockType);
            // Parse depth and tier from encoded format (e.g., "trunk_0_5" or "t_2_3")
            const parts = meshBlockType.split('_');
            if (parts.length >= 3) {
              treeDepth = parseInt(parts[parts.length - 2], 10);
              treeTier = parseInt(parts[parts.length - 1], 10);
            }
          }

          // Build sources object
          const sources: InspectSources = {
            mesh: {
              found: inMesh,
              instanceId: inMesh ? instanceId : undefined,
              meshName: inMesh ? meshName : undefined,
              blockType: meshBlockType || undefined
            },
            state: {
              found: !!matchedInState,
              blockId: matchedInState?.id,
              blockType: matchedInState?.block_type,
              userId: matchedInState?.user_id || undefined,
              createdAt: matchedInState?.created_at,
              expiresAt: matchedInState?.expires_at || undefined
            },
            chunks: {
              found: chunksFound,
              chunkKey: chunksFound ? chunkKey : undefined,
              fromVisibleBlocks,
              blockCount: chunkBlockCount
            },
            indexedDB: {
              found: false,
              loading: true // Will be updated async
            },
            collider: {
              found: colliderFound,
              bounds: colliderBounds
            },
            tree: {
              found: isTree,
              baseType: treeBaseType,
              depth: treeDepth,
              tier: treeTier
            }
          };

          // Detect orphans (before async IDB check)
          const orphanDetails: string[] = [];
          if (inMesh && !matchedInState) orphanDetails.push('In mesh but not in state array');
          if (inMesh && !chunksFound) orphanDetails.push('In mesh but not in loaded chunks');
          if (matchedInState && !colliderFound && !isGround) orphanDetails.push('In state but missing collider');
          if (colliderFound && !chunksFound) orphanDetails.push('Has collider but not in loaded chunks');

          // Build raw info for clipboard
          const buildRawInfo = (s: InspectSources, orphans: string[]): string => {
            return [
              `=== BLOCK INSPECTOR ===`,
              `Position: (${bx}, ${by}, ${bz})`,
              `LoS Distance: ${losDistance.toFixed(1)} blocks`,
              `Is Ground: ${isGround}`,
              ``,
              `--- DATA SOURCES ---`,
              `Mesh: ${s.mesh.found ? `YES (${s.mesh.blockType}, inst#${s.mesh.instanceId})` : 'NO'}`,
              `State: ${s.state.found ? `YES (${s.state.blockType}, id:${s.state.blockId})` : 'NO'}`,
              `Chunks: ${s.chunks.found ? `YES (${s.chunks.chunkKey}${s.chunks.fromVisibleBlocks ? ', visible' : ''})` : 'NO'}`,
              `IndexedDB: ${s.indexedDB.loading ? 'LOADING...' : (s.indexedDB.found ? `YES (${s.indexedDB.blockType})` : 'NO')}`,
              `Collider: ${s.collider.found ? 'YES' : 'NO'}`,
              `Tree: ${s.tree.found ? `YES (${s.tree.baseType}, depth:${s.tree.depth}, tier:${s.tree.tier})` : 'NO'}`,
              ``,
              `--- CONSISTENCY ---`,
              orphans.length > 0 ? `ORPHANED:\n${orphans.map(o => `  - ${o}`).join('\n')}` : 'All sources consistent',
              ``,
              s.state.found ? [
                `--- BLOCK DETAILS ---`,
                `ID: ${s.state.blockId}`,
                `Type: ${s.state.blockType}`,
                `Owner: ${s.state.userId || 'unowned'}`,
                `Created: ${s.state.createdAt}`,
                `Expires: ${s.state.expiresAt || 'never'}`,
              ].join('\n') : '--- NO STATE RECORD ---',
            ].join('\n');
          };

          const timestamp = Date.now();

          // Set initial inspect data (before async IDB check)
          const inspectData: GlobalInspectData = {
            gridPos: { x: bx, y: by, z: bz },
            losDistance,
            isGround,
            sources,
            isOrphaned: orphanDetails.length > 0,
            orphanDetails,
            rawInfo: buildRawInfo(sources, orphanDetails),
            timestamp
          };

          setGlobalInspectData(inspectData);
          console.log(inspectData.rawInfo);

          // Async IndexedDB check
          if (currentWorldId) {
            blockDB.getCachedChunk(currentWorldId, chunkX, chunkZ).then(cached => {
              if (cached) {
                const match = cached.blocks.find(b =>
                  Math.floor(b.position_x) === bx &&
                  Math.floor(b.position_y) === by &&
                  Math.floor(b.position_z) === bz
                );

                const updatedSources: InspectSources = {
                  ...sources,
                  indexedDB: {
                    found: !!match,
                    loading: false,
                    chunkKey: `${currentWorldId}:${chunkX}:${chunkZ}`,
                    blockType: match?.block_type,
                    cachedAt: cached.cachedAt
                  }
                };

                // Update orphan detection with IDB info
                const updatedOrphans = [...orphanDetails];
                if (chunksFound && !match) {
                  updatedOrphans.push('In memory chunks but not in IndexedDB cache');
                }
                if (match && !chunksFound) {
                  updatedOrphans.push('In IndexedDB but not loaded in memory');
                }

                const updatedData: GlobalInspectData = {
                  ...inspectData,
                  sources: updatedSources,
                  isOrphaned: updatedOrphans.length > 0,
                  orphanDetails: updatedOrphans,
                  rawInfo: buildRawInfo(updatedSources, updatedOrphans)
                };

                setGlobalInspectData(updatedData);
                console.log('[BlockInspector] IndexedDB check complete:', match ? 'FOUND' : 'NOT FOUND');
              } else {
                // No cached chunk - update loading state
                const updatedSources: InspectSources = {
                  ...sources,
                  indexedDB: {
                    found: false,
                    loading: false,
                    chunkKey: `${currentWorldId}:${chunkX}:${chunkZ}`
                  }
                };

                setGlobalInspectData({
                  ...inspectData,
                  sources: updatedSources,
                  rawInfo: buildRawInfo(updatedSources, orphanDetails)
                });
              }
            }).catch(err => {
              console.error('[BlockInspector] IndexedDB check failed:', err);
              setGlobalInspectData({
                ...inspectData,
                sources: {
                  ...sources,
                  indexedDB: { found: false, loading: false }
                }
              });
            });
          } else {
            // No world ID - mark IDB as not checked
            setGlobalInspectData({
              ...inspectData,
              sources: {
                ...sources,
                indexedDB: { found: false, loading: false }
              }
            });
          }
        }
      }
    }
    if (event.button === 0) {
      leftMouseDownRef.current = true;
      chopStartTimeRef.current = performance.now();
      chopCountRef.current = 0;
      choppingPositionRef.current = null;

      // Start flame glove or pentabullet charge if in shooting mode
      if (showCrosshairs && !blockPlacementMode && !treePlacementMode && !widePlacementMode) {
        if (isFlameGloveSelected && onFlameStart) {
          // Flame Glove selected — start flamethrower
          onFlameStart();
        } else {
          pentabulletChargeStartRef.current = performance.now();
        }
      }
    }
  }, [showCrosshairs, blockPlacementMode, treePlacementMode, isFlameGloveSelected, onFlameStart, userRoles, raycastMeshes, existingBlocks, camera]);

  handleMouseDownRef.current = handleMouseDown;

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (event.button === 2) {
      keys.current.rightMouse = false;
      setHoveredBlockId(null);
    }
    if (event.button === 0) {
      // Stop flame glove if active
      if (isFlameGloveSelected && onFlameStop) {
        onFlameStop();
      }

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
  }, [setHoveredBlockId, onTreeChopProgress, showCrosshairs, firePentabullet, cancelPentabulletCharge, isFlameGloveSelected, onFlameStop]);
  
  handleMouseUpRef.current = handleMouseUp;

  const handlePointerLockChange = useCallback(() => {
    isLocked.current = document.pointerLockElement === gl.domElement;
    // Cancel pentabullet if pointer lock is lost
    if (!isLocked.current && pentabulletPhaseRef.current !== 'idle') {
      cancelPentabulletCharge();
    }
    // Clear all movement keys when pointer lock is lost — held keys
    // can otherwise stick (the browser stops delivering keyup once the
    // canvas loses focus). Worst case before this: a player holding
    // Ctrl when a panel auto-opened (or any focus shift) would stay
    // crouched after returning, then a second Ctrl press could send
    // weird state to other handlers.
    if (!isLocked.current) {
      const k = keys.current;
      k.w = k.s = k.a = k.d = false;
      k.shift = k.space = k.ctrl = k.q = k.z = k.e = false;
      k.previouslyCtrl = false;
      k.rightMouse = false;
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
  const stableClickListener = useCallback((event: MouseEvent) => {
    if (event.button !== 0) return; // Only left-click triggers actions
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

  // Block mining ref (admin only)
  const onBlockMineCompleteRef = useRef(onBlockMineComplete);
  
  // Fruit harvest refs
  const onHarvestFruitRef = useRef(onHarvestFruit);

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
  useEffect(() => { onBlockMineCompleteRef.current = onBlockMineComplete; }, [onBlockMineComplete]);
  useEffect(() => { onHarvestFruitRef.current = onHarvestFruit; }, [onHarvestFruit]);
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

      const now = performance.now();

      // Inspector Mode: continuous raycasting to update block info as user looks around
      if (inspectorModeEnabled && isLocked.current) {
        if (now - lastInspectorCheckRef.current > 50) { // Throttle to 20fps
          lastInspectorCheckRef.current = now;

          const meshesArray = meshesArrayCache.current;
          let bx = 0, by = 0, bz = 0;
          let foundBlock = false;
          let meshBlockType: string | undefined;
          let isGround = false;
          let instanceId = -1;

          // Try raycast against placed block meshes first
          const result = meshesArray.length > 0 ? raycastMeshes(meshesArray, 20) : null;

          if (result && result.instanceId !== undefined) {
            // Hit an instanced mesh
            foundBlock = true;
            meshBlockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);
            const mesh = result.object as THREE.InstancedMesh;
            mesh.getMatrixAt(result.instanceId, _inspectorMatrix);
            _inspectorPos.setFromMatrixPosition(_inspectorMatrix);

            bx = Math.floor(_inspectorPos.x);
            by = Math.floor(_inspectorPos.y);
            bz = Math.floor(_inspectorPos.z);
            instanceId = result.instanceId;
          } else {
            // No mesh hit - ray march along LoS checking colliders
            camera.getWorldDirection(_inspectorDir);
            const camDir = _inspectorDir;
            const maxDistance = 20;
            const stepSize = 0.5;
            let lastCheckedX = -99999, lastCheckedY = -99999, lastCheckedZ = -99999;

            for (let dist = 1; dist < maxDistance && !foundBlock; dist += stepSize) {
              const checkX = Math.floor(camera.position.x + camDir.x * dist);
              const checkY = Math.floor(camera.position.y + camDir.y * dist);
              const checkZ = Math.floor(camera.position.z + camDir.z * dist);

              if (checkX === lastCheckedX && checkY === lastCheckedY && checkZ === lastCheckedZ) continue;
              lastCheckedX = checkX;
              lastCheckedY = checkY;
              lastCheckedZ = checkZ;

              const colliderCount = worldCollisionGrid.getNearbyFiltered(
                checkX + 0.5, checkZ + 0.5, 1.0, checkY, checkY + 1
              );

              if (colliderCount > 0) {
                const nearby = worldCollisionGrid.nearbyResult;
                for (let i = 0; i < colliderCount; i++) {
                  const c = nearby[i];
                  if (c.min.x <= checkX + 0.9 && c.max.x >= checkX + 0.1 &&
                      c.min.y <= checkY + 0.9 && c.max.y >= checkY + 0.1 &&
                      c.min.z <= checkZ + 0.9 && c.max.z >= checkZ + 0.1) {
                    bx = checkX;
                    by = checkY;
                    bz = checkZ;
                    foundBlock = true;
                    meshBlockType = 'unknown (collider)';
                    break;
                  }
                }
              }
            }

            // Check for ground intersection
            if (!foundBlock && camDir.y < -0.01) {
              const t = -camera.position.y / camDir.y;
              if (t > 0 && t < maxDistance) {
                bx = Math.floor(camera.position.x + camDir.x * t);
                by = 0;
                bz = Math.floor(camera.position.z + camDir.z * t);
                isGround = true;
                foundBlock = true;
                meshBlockType = 'grass_block';
              }
            }
          }

          // Only update if position changed or we went from block to sky
          const posChanged = bx !== lastInspectorPosRef.current.x ||
                            by !== lastInspectorPosRef.current.y ||
                            bz !== lastInspectorPosRef.current.z;

          if (posChanged || (!foundBlock && globalInspectData)) {
            lastInspectorPosRef.current = { x: bx, y: by, z: bz };

            if (foundBlock) {
              // Look up block in state
              const matchedInState = existingBlocks?.find((b: PlacedBlock) =>
                Math.floor(b.position_x) === bx &&
                Math.floor(b.position_y) === by &&
                Math.floor(b.position_z) === bz
              );

              const losDistance = (_inspectorDistVec.set(bx + 0.5, by + 0.5, bz + 0.5), camera.position.distanceTo(_inspectorDistVec));

              // Check for tree data
              const isTree = meshBlockType ? isTreeBlockType(meshBlockType) : false;
              let treeBaseType: string | undefined;
              let treeDepth: number | undefined;
              let treeTier: number | undefined;

              if (isTree && meshBlockType) {
                treeBaseType = getBaseTreeBlockType(meshBlockType);
                const parts = meshBlockType.split('_');
                if (parts.length >= 3) {
                  treeDepth = parseInt(parts[parts.length - 2], 10);
                  treeTier = parseInt(parts[parts.length - 1], 10);
                }
              }

              const chunkX = Math.floor(bx / CHUNK_SIZE);
              const chunkZ = Math.floor(bz / CHUNK_SIZE);

              // Check collider
              const colliderCount = worldCollisionGrid.getNearbyFiltered(bx + 0.5, bz + 0.5, 1.0, by, by + 1);
              let colliderFound = false;
              const nearby = worldCollisionGrid.nearbyResult;
              for (let i = 0; i < colliderCount; i++) {
                const c = nearby[i];
                if (c.min.x <= bx + 0.9 && c.max.x >= bx + 0.1 &&
                    c.min.y <= by + 0.9 && c.max.y >= by + 0.1 &&
                    c.min.z <= bz + 0.9 && c.max.z >= bz + 0.1) {
                  colliderFound = true;
                  break;
                }
              }

              const sources: InspectSources = {
                mesh: {
                  found: instanceId >= 0,
                  instanceId: instanceId >= 0 ? instanceId : undefined,
                  blockType: meshBlockType
                },
                state: {
                  found: !!matchedInState,
                  blockId: matchedInState?.id,
                  blockType: matchedInState?.block_type,
                  userId: matchedInState?.user_id || undefined,
                  createdAt: matchedInState?.created_at,
                  expiresAt: matchedInState?.expires_at || undefined
                },
                chunks: {
                  found: false, // Skip detailed chunk check for performance
                  chunkKey: `chunk_${chunkX}_${chunkZ}`
                },
                indexedDB: {
                  found: false,
                  loading: false
                },
                collider: {
                  found: colliderFound
                },
                tree: {
                  found: isTree,
                  baseType: treeBaseType,
                  depth: treeDepth,
                  tier: treeTier
                }
              };

              const orphanDetails: string[] = [];
              if (instanceId >= 0 && !matchedInState) orphanDetails.push('In mesh but not in state');
              if (matchedInState && !colliderFound && !isGround) orphanDetails.push('In state but missing collider');

              setGlobalInspectData({
                gridPos: { x: bx, y: by, z: bz },
                losDistance,
                isGround,
                sources,
                isOrphaned: orphanDetails.length > 0,
                orphanDetails,
                rawInfo: '',
                timestamp: now
              });
            } else {
              // Looking at sky - clear data
              clearGlobalInspectData();
            }
          }
        }
      }

      // Block hover detection for removal - THROTTLED to avoid per-frame setState
      // Only check every 100ms and only call setState when value actually changes
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
      
      // Fruit harvest is now F-key based (handled in keydown handler)
      const fruitHarvestActive = false;

      // Tree chopping detection - hold left mouse on owned tree blocks (not in shooting mode)
      // Skip if actively harvesting a fruit
      // IMPORTANT: Must use showCrosshairsRef.current, not showCrosshairs, because this is in a frame loop
      // Debug: Log every 500ms when holding left mouse to trace chopping flow
      if (leftMouseDownRef.current && !showCrosshairsRef.current && !fruitHarvestActive && isOwnedTreeAtPositionRef.current) {
        // Raycast to find what we're looking at
        const meshesArray = meshesArrayCache.current;
        if (meshesArray.length > 0) {
          const result = raycastMeshes(meshesArray, 15);

          if (result && result.instanceId !== undefined) {
            const blockType = meshToBlockTypeCache.current.get(result.object as THREE.InstancedMesh);

            // Determine what we're looking at
            const isTreeBlock = blockType && (isTreeBlockType(blockType) || blockType === 'tree_atlas' || blockType === 'tree_fallback');
            const isAdmin = userRolesRef.current?.some((r: string) => r === 'admin' || r === 'superadmin');

            // Get block position from instanced mesh matrix
            const mesh = result.object as THREE.InstancedMesh;
            mesh.getMatrixAt(result.instanceId, _inspectorMatrix);
            _inspectorPos.setFromMatrixPosition(_inspectorMatrix);

            // Instanced meshes are centered at +0.5, so subtract before rounding
            const blockX = Math.floor(_inspectorPos.x);
            const blockY = Math.floor(_inspectorPos.y);
            const blockZ = Math.floor(_inspectorPos.z);

            // Check ownership for tree blocks
            const isOwnedTree = isTreeBlock && isOwnedTreeAtPositionRef.current(blockX, blockY, blockZ);

            if (isOwnedTree) {
              // OWNED TREE: hold-to-chop with confirmation modal
              const isNewBlock = !choppingPositionRef.current ||
                  choppingPositionRef.current.x !== blockX ||
                  choppingPositionRef.current.y !== blockY ||
                  choppingPositionRef.current.z !== blockZ;

              if (isNewBlock) {
                choppingPositionRef.current = { x: blockX, y: blockY, z: blockZ };
                chopCountRef.current = 0;
                lastChopSoundTimeRef.current = now - CHOP_INTERVAL_MS;
              }

              const timeSinceLastChop = now - lastChopSoundTimeRef.current;
              if (timeSinceLastChop >= CHOP_INTERVAL_MS) {
                lastChopSoundTimeRef.current = now;
                chopCountRef.current++;

                playSpatialSound(getSoundUrl('axe_chop', '/axe_chop.mp3'), 0, { baseVolume: 0.6 });

                if (onTreeChopProgressRef.current) {
                  onTreeChopProgressRef.current(chopCountRef.current, CHOPS_REQUIRED);
                }

                if (chopCountRef.current >= CHOPS_REQUIRED) {
                  if (onTreeChopCompleteRef.current) {
                    onTreeChopCompleteRef.current(blockX, blockY, blockZ);
                  }
                  leftMouseDownRef.current = false;
                  chopCountRef.current = 0;
                  choppingPositionRef.current = null;
                }
              }
            } else if (blockType && blockY >= 0 && isAdmin && onBlockMineCompleteRef.current) {
              // ADMIN MINING: any block that isn't an owned tree (placed blocks, unowned tree blocks, etc.)
              const isNewBlock = !choppingPositionRef.current ||
                  choppingPositionRef.current.x !== blockX ||
                  choppingPositionRef.current.y !== blockY ||
                  choppingPositionRef.current.z !== blockZ;

              if (isNewBlock) {
                choppingPositionRef.current = { x: blockX, y: blockY, z: blockZ };
                chopCountRef.current = 0;
                lastChopSoundTimeRef.current = now - CHOP_INTERVAL_MS;
              }

              const timeSinceLastChop = now - lastChopSoundTimeRef.current;
              if (timeSinceLastChop >= CHOP_INTERVAL_MS) {
                lastChopSoundTimeRef.current = now;
                chopCountRef.current++;

                playSpatialSound(getSoundUrl('axe_chop', '/axe_chop.mp3'), 0, { baseVolume: 0.6 });

                if (onTreeChopProgressRef.current) {
                  onTreeChopProgressRef.current(chopCountRef.current, CHOPS_REQUIRED);
                }

                if (chopCountRef.current >= CHOPS_REQUIRED) {
                  onBlockMineCompleteRef.current(blockX, blockY, blockZ);
                  leftMouseDownRef.current = false;
                  chopCountRef.current = 0;
                  choppingPositionRef.current = null;
                }
              }
            } else {
              // Not a minable block - reset chopping state
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
          if (pentabulletPowerupAudioRef.current) {
            pentabulletPowerupAudioRef.current.currentTime = 0;
            pentabulletPowerupAudioRef.current.play().catch(() => {});
          }
        }
        
        // At 5 seconds, switch to steady sound (looping)
        if (chargeTime >= 5.0 && pentabulletPhaseRef.current === 'powerup') {
          pentabulletPhaseRef.current = 'steady';
          // Stop powerup
          if (pentabulletPowerupAudioRef.current) {
            pentabulletPowerupAudioRef.current.pause();
          }
          // Start steady (looping) - use preloaded ref
          if (pentabulletSteadyAudioRef.current) {
            pentabulletSteadyAudioRef.current.currentTime = 0;
            pentabulletSteadyAudioRef.current.play().catch(() => {});
          }
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
      const isAdmin = userRolesRef.current.includes('admin') || userRolesRef.current.includes('superadmin');
      const superSprintActive = isAdmin && keys.current.shift && keys.current.e;
      const superSprintSpeed = baseSpeed * 10; // 10x normal speed for admin Shift+E
      const runSpeed = godModeRef.current
        ? godSpeed
        : (superSprintActive ? superSprintSpeed : (keys.current.ctrl ? crawlSpeed : (keys.current.shift ? 8.0 : baseSpeed)));
      
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
      const SURFACE_EPS = 0.005;
      
      // === SWIMMING DETECTION ===
      // Check if player is in water at current position
      const feetY = camera.position.y - 1.6; // Player feet position
      const wasInWater = isInWaterRef.current;

      if (checkIsInWater) {
        const inWater = checkIsInWater(camera.position.x, feetY, camera.position.z);
        isInWaterRef.current = inWater;

        if (inWater && getWaterType) {
          waterTypeRef.current = getWaterType(camera.position.x, feetY, camera.position.z);
        } else {
          waterTypeRef.current = null;
        }

        // Notify swimming state change
        if (inWater !== lastSwimmingStateRef.current) {
          lastSwimmingStateRef.current = inWater;
          onSwimmingStateChange?.(inWater, waterTypeRef.current);
        }

        // Lava damage - 10 HP every 500ms
        if (waterTypeRef.current === 'lava' && onLavaDamage) {
          if (now - lastLavaDamageTimeRef.current >= 500) {
            lastLavaDamageTimeRef.current = now;
            onLavaDamage(10);
          }
        }
      }

      const isSwimming = isInWaterRef.current;

      // Gliding: press G while falling to activate, auto-deactivates on landing
      // Glide is active as long as player is airborne (works during jet boosts too)
      const isGliding = glideActiveRef.current && !onGround.current && !isSwimming;

      // Determine effective gravity based on state
      let effectiveGravity = 9.8; // Normal gravity
      if (isSwimming) {
        effectiveGravity = 2.45; // 25% gravity in water (Minecraft-style)
      } else if (isGliding) {
        effectiveGravity = 4.9; // 50% gravity when gliding
      }

      // Auto-deactivate glide only when landing on ground
      if (glideActiveRef.current && onGround.current) {
        glideActiveRef.current = false;
      }

      // === JET BOOST SYSTEM ===
      // Update max charges based on player level (1 per 3 levels, rounded down)
      const level = playerLevelRef.current || 0;
      const newMaxBoosts = Math.floor(level / 3);
      if (newMaxBoosts !== jetBoostMaxRef.current) {
        console.log(`[JetBoost] Level ${level} → Max boosts changing from ${jetBoostMaxRef.current} to ${newMaxBoosts}`);
        jetBoostMaxRef.current = newMaxBoosts;
        // Cap available to new max
        jetBoostAvailRef.current = Math.min(jetBoostAvailRef.current, newMaxBoosts);
        // Grant initial charges when first qualifying
        if (jetBoostAvailRef.current === 0 && newMaxBoosts > 0) {
          jetBoostAvailRef.current = newMaxBoosts;
        }
        console.log(`[JetBoost] Available: ${jetBoostAvailRef.current}, Max: ${jetBoostMaxRef.current}`);
      }

      // Refill charges every 60 seconds
      if (jetBoostMaxRef.current > 0) {
        if (jetBoostNextRefillRef.current === 0) {
          jetBoostNextRefillRef.current = now + 60000;
        } else if (now >= jetBoostNextRefillRef.current) {
          jetBoostAvailRef.current = jetBoostMaxRef.current;
          jetBoostNextRefillRef.current = now + 60000;
        }
      } else {
        jetBoostAvailRef.current = 0;
        jetBoostNextRefillRef.current = 0;
      }

      // Check for jet boost activation (space key edge, airborne, has charges)
      // Works anytime player is not on ground - jumping, falling, or gliding
      if (spaceKeyEdgeRef.current) {
        spaceKeyEdgeRef.current = false;
        const isAirborne = !onGround.current;

        if (isAirborne && jetBoostAvailRef.current > 0) {
          jetBoostAvailRef.current -= 1;
          jetBoostRequestRef.current = true;
        }
      }

      // Apply jet boost if requested
      if (jetBoostRequestRef.current) {
        jetBoostRequestRef.current = false;

        // Calculate horizontal speed
        const vx = velocity.current.x;
        const vz = velocity.current.z;
        const hSpeed = Math.hypot(vx, vz);

        // Forward direction from camera
        const forwardDir = forwardVecRef.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));

        // Determine horizontal direction
        let horizDir = rightVecRef.current.set(vx, 0, vz);
        if (hSpeed > 0.25) {
          horizDir.multiplyScalar(1 / hSpeed);
        } else if (direction.current.lengthSq() > 0.0001) {
          horizDir.copy(direction.current);
          horizDir.y = 0;
          horizDir.normalize();
        } else {
          horizDir.copy(forwardDir);
        }

        const boostStrength = 9.0;
        const cos45 = 0.70710678;
        const sin45 = 0.70710678;

        // Apply boost based on current movement
        if (velocity.current.y < 0 && hSpeed > 0.25) {
          // Falling at an angle: vertical boost only (don't change horizontal)
          velocity.current.y = Math.max(velocity.current.y, 0) + boostStrength;
        } else {
          // Boost 45 degrees up in current direction
          const boostX = horizDir.x * cos45 * boostStrength;
          const boostY = sin45 * boostStrength;
          const boostZ = horizDir.z * cos45 * boostStrength;
          velocity.current.x += boostX;
          velocity.current.y += boostY;
          velocity.current.z += boostZ;
        }

        // Trigger VFX at feet position
        const feetPos = testPosRef.current.clone();
        feetPos.copy(camera.position);
        feetPos.y -= 1.6; // Feet position below camera
        onJetBoostFired?.(feetPos, []); // Colors will be determined by Scene based on tier

        // Play jet boost sound via spatial audio
        playSpatialSound(getSoundUrl('jet_boots', '/jet_boots_1.mp3'), 0, { baseVolume: 0.6 });

        // Immediately update HUD when boost is used
        onJetBoostStateChange?.({
          available: jetBoostAvailRef.current,
          max: jetBoostMaxRef.current,
          nextRefillAtMs: jetBoostNextRefillRef.current,
          isGliding: glideActiveRef.current,
        });
      }

      // Update jet boost state for HUD (throttled to 10Hz for responsive glide indicator)
      if (now - lastJetBoostStateUpdateRef.current > 100) {
        lastJetBoostStateUpdateRef.current = now;
        onJetBoostStateChange?.({
          available: jetBoostAvailRef.current,
          max: jetBoostMaxRef.current,
          nextRefillAtMs: jetBoostNextRefillRef.current,
          isGliding: glideActiveRef.current,
        });
      }

      // Gravity and jumping
      velocity.current.y -= effectiveGravity * dt;
      // Minecraft/Quake pattern: zero gravity when on ground to prevent bounce oscillation
      if (onGround.current && velocity.current.y < 0) {
        velocity.current.y = 0;
      }

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
          const nearbyCount = worldCollisionGrid.getNearbyFiltered(
            camera.position.x,
            camera.position.z,
            2.0,
            camera.position.y - crawlingHeight,
            testStandY + 1.0
          );
          const nearbyColliders = worldCollisionGrid.nearbyResult;
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
      const candidateCount = worldCollisionGrid.getNearbyFiltered(
        camera.position.x,
        camera.position.z,
        2.0,
        candidateMinY,
        candidateMaxY
      );

      const currentColliders = collidersRef.current;
      currentColliders.length = candidateCount;
      const nearby = worldCollisionGrid.nearbyResult;
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
          // Clear knockback on this axis too to prevent re-pushing
          knockbackVelRef.current.x = 0;
        } else if (push.axis === 'z') {
          camera.position.z = push.direction === -1
            ? overlap.min.z - playerRadius - SURFACE_EPS
            : overlap.max.z + playerRadius + SURFACE_EPS;
          velocity.current.z = 0;
          // Clear knockback on this axis too to prevent re-pushing
          knockbackVelRef.current.z = 0;
        } else {
          if (push.direction === 1) {
            // Already resting on ground — don't push up again (prevents bounce oscillation)
            if (onGround.current && velocity.current.y >= 0) {
              break;
            }
            // Pushed UP onto a surface - set position but DON'T zero velocity
            // This allows gravity to immediately start pulling player back down
            camera.position.y = overlap.max.y + playerHeight + SURFACE_EPS;
            // Only zero velocity and set onGround if we're falling DOWN onto this block
            // If we're being pushed up from the side, keep falling
            if (velocity.current.y < 0) {
              velocity.current.y = 0;
              onGround.current = true;
            }
            // Don't set onGround = true if we're moving up or stationary
            // This prevents knockback-induced floating
          } else {
            // Pushed DOWN (hit ceiling)
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
      
      // === SWIMMING MOVEMENT ===
      // In water: Space = swim up, Shift = swim down, reduced movement speed
      const roles = userRolesRef.current;

      if (isSwimming) {
        const swimSpeed = 4.0; // Swim up/down speed

        // Space = swim up
        if (keys.current.space) {
          velocity.current.y = swimSpeed;
          // Natural buoyancy - slight upward drift when not pressing anything
        } else if (keys.current.shift) {
          // Shift = swim down
          velocity.current.y = -swimSpeed;
        } else {
          // Apply slight buoyancy (slow rise) when not actively swimming
          velocity.current.y = Math.max(velocity.current.y, 0.5);
        }

        // Reduce horizontal movement in water (60% speed)
        deltaMovement.x *= 0.6;
        deltaMovement.z *= 0.6;
      } else {
        // Normal ground-based jump logic
        const canJump = onGround.current && !keys.current.ctrl;

        if (keys.current.space && canJump) {
          let jumpHeight = 1.25;
          if (roles.includes('admin') || roles.includes('superadmin')) {
            jumpHeight = 2.5;
          }
          velocity.current.y = Math.sqrt(2 * 9.8 * jumpHeight);
          onGround.current = false;
        }
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
      
      // Edge detection: when on ground, check if there's still a block below.
      // This is a lightweight check — no snapping, just sets onGround=false if
      // the player walked off an edge. The full ground check below handles landing.
      if (onGround.current && isMovingHorizontally) {
        feetCheckPosRef.current.copy(camera.position);
        feetCheckPosRef.current.y = camera.position.y - 0.1; // probe 0.1 below

        const edgeHit = checkAxisCollisionFromCandidates(
          feetCheckPosRef.current,
          currentColliders,
          candidateCount,
          playerRadius,
          playerHeight,
          'y',
          -1,
          true,
          0
        );

        const feetY = camera.position.y - playerHeight;
        const onWorldGround = feetY <= (SURFACE_EPS + 0.01);

        if (!edgeHit && !onWorldGround) {
          onGround.current = false;
        }
      }

      // Ground detection (robust): test a small downward move using the SAME player box convention
      // Only runs when airborne or falling fast — prevents bounce oscillation when standing
      const needsGroundCheck = !onGround.current || velocity.current.y < -0.5;
      if (needsGroundCheck) {
        const GROUND_SNAP_DIST = 0.02;

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

          // Check if standing on a walapa (moving platform)
          const walapaCollider = groundHit as THREE.Box3 & { __isWalapaCollider?: boolean; __walapaId?: string };
          if (walapaCollider?.__isWalapaCollider && walapaCollider.__walapaId && walapasRef?.current) {
            const walapa = walapasRef.current.find(w => w.id === walapaCollider.__walapaId && w.isActive);
            if (walapa) {
              // Check if this is the same walapa we were on before
              if (currentWalapaIdRef.current === walapa.id) {
                // Calculate walapa movement delta and apply to player
                walapaDeltaRef.current.set(
                  walapa.position.x - walapaLastPosRef.current.x,
                  walapa.position.y - walapaLastPosRef.current.y,
                  walapa.position.z - walapaLastPosRef.current.z
                );
                // Apply walapa movement to player position
                camera.position.x += walapaDeltaRef.current.x;
                camera.position.y += walapaDeltaRef.current.y;
                camera.position.z += walapaDeltaRef.current.z;
              }
              // Update tracking
              currentWalapaIdRef.current = walapa.id;
              walapaLastPosRef.current.copy(walapa.position);
            } else {
              currentWalapaIdRef.current = null;
            }
          } else {
            // Not on a walapa - clear tracking
            currentWalapaIdRef.current = null;
          }
        } else {
          onGround.current = false;
          // Player left the ground - if was on walapa, inherit its velocity
          if (currentWalapaIdRef.current && walapasRef?.current) {
            const walapa = walapasRef.current.find(w => w.id === currentWalapaIdRef.current && w.isActive);
            if (walapa && walapa.velocity) {
              // Add walapa velocity to player velocity (for jumping off)
              velocity.current.x += walapa.velocity.x;
              velocity.current.z += walapa.velocity.z;
              // Don't add Y velocity - player controls their own vertical movement
            }
          }
          currentWalapaIdRef.current = null;
        }
      }

      // Broadcast position to multiplayer (throttled to 20Hz)
      if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
        lastBroadcastRef.current = now;
        const broadcast = broadcastPositionRef.current;
        if (broadcast) {
          broadcast(camera.position, yaw.current, pitch.current);
        }

        // Update player tracker for enemy awareness
        // Direction from yaw (facing direction on XZ plane)
        playerDirectionRef.current.set(
          -Math.sin(yaw.current),
          0,
          -Math.cos(yaw.current)
        );
        playerTracker.updatePlayer('local', camera.position, playerDirectionRef.current);
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
