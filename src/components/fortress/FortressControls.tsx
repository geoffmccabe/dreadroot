import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import { sdbg } from '@/components/siege/siegeDebug'; // SW debug readout (temporary)
import { isSiegePlayerDead } from '@/components/siege/siegePlayerState'; // stop weapons the instant the player dies
import { isSiegeIntroActive } from '@/components/siege/spawnintro/siegeSpawnIntro'; // SW spawn cinematic owns the camera
import { isKaijuWalkActive, enterWalkMode as enterKaijuWalkMode } from '@/components/siege/globe/KaijuWalkController'; // Mini Earth walk mode owns the camera
import { getTPDist, nudgeTPDist } from '@/components/siege/siegeThirdPerson'; // SW third-person camera pull-back (Alt+wheel)
import { playerState as siegePlayerPose } from '@/components/siege/playerState'; // publish the true player eye for the self-avatar
import { corpseSlow } from '@/components/siege/siegeCorpses'; // SW: half-speed wade over monster corpses (no-op in DreadRoot)
import * as THREE from 'three';
import { useRaycaster } from '@/hooks/useRaycaster';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { triggerChop } from './chopFeedbackStore';
import { PlacedBlock } from '@/types/blocks';
import { playSpatialSound, preloadSpatialSounds, play3DPositionalSound } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { getActiveWeapon, getRightWeapon, getFireWeapon, useActiveWeapon, type ActiveWeaponStats } from '@/config/activeWeapon';
import { getFlameGlove } from '@/config/flameGlove';
import { getRocketBelt, getRocketBeltMax, setRocketBeltAvailable } from '@/config/rocketBelt';
import { BURST_SEC, BURST_REGEN_SEC } from '@/features/rocketBelt/rocketBelt';
import { getAiming, setAiming } from '@/config/aimState';
import { getBaseFov } from '@/config/fovSetting';
import { isQASuppressed } from '@/config/qaGuard';
import { flashCenter } from '@/config/centerFlash';
import { canFire, consumeAmmo, resetAmmoForWeapon, canReload, beginReload, finishReload, getAmmo } from '@/config/weaponAmmo';
import { getActiveGame } from '@/config/activeGame';
import { gameUsesVoxels } from '@/config/gameRegistry';
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
import { EnemyManager } from '@/features/enemies/ai/EnemyManager';
import { WALAPA_BOB_AMPLITUDE, getTierDimensions } from '@/features/walapa';
import { isTreeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { playerTracker } from '@/lib/playerTracker';
import { setGlobalInspectData, clearGlobalInspectData, toggleInspectorMode, setInspectorMode, inspectorModeEnabled, globalInspectData, type GlobalInspectData, type InspectSources } from '@/components/FPSCounter';
import { blockDB } from '@/hooks/useIndexedDB';
import { supabase } from '@/integrations/supabase/client';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { type WaterType } from '@/lib/pondGenerator';
import { isPointInNoFireZone } from '@/features/enemies/ai/fortressSafeZone';
import { playPinPullSound } from '@/features/grenades/lib/explosionSound';
import { getVaultInRange, getMarketInRange } from '@/components/siege/siegeLobbyZones';
import { dlog } from '@/lib/debugLog';
import { SW_BASE_WALK, SW_BASE_RUN } from '@/features/characters/dreadrootCharacters';
import { getSelectedCharacterSpeedScale } from '@/features/characters/characterSelection';
import { triggerAction } from '@/features/characters/animation/characterActions';
import { useParkour } from '@/features/parkour';
import { applyThirdPerson } from '@/features/camera/cameraClearance';

// Pre-allocated scratch objects for inspector/raycast (avoid per-frame GC)
const _inspectorMatrix = new THREE.Matrix4();
const _inspectorPos = new THREE.Vector3();
const _inspectorDir = new THREE.Vector3();
const _inspectorDistVec = new THREE.Vector3();
const _sdbgDir = new THREE.Vector3();   // scratch: camera look dir for the siege debug readout
const _spreadWorldUp = new THREE.Vector3(0, 1, 0);   // constant world-up for spread basis
const UP_Y = new THREE.Vector3(0, 1, 0);             // default vertical axis (flat maps)
// Scratch for the spherical camera basis (cameraUpFn path). Module-level so the hot path allocates nothing.
const WORLD_Y_CAM = new THREE.Vector3(0, 1, 0);
const _cuEast = new THREE.Vector3(), _cuNorth = new THREE.Vector3(), _cuFwd = new THREE.Vector3();
const _cuRight = new THREE.Vector3(), _cuUp = new THREE.Vector3();
const _cuMat = new THREE.Matrix4();

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
  // G key — throw one throwable from the quick bar, immediately. The parent
  // picks which one (lowest-numbered bar slot) and spends it. There is no
  // arming step and no "ready" state for the controls to track, so nothing
  // here can get out of sync with what the player is actually carrying.
  onThrowPress,
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
  // Siege Worlds: float the player (god-mode noclip) because heightfield terrain
  // has no block-collision yet. Gated — false for the voxel Dreadroot world.
  forceFloat = false,
  // Siege Worlds: heightfield ground sampler (world Y, or null off-map/not-loaded). When
  // provided, the player walks on this terrain floor (no block colliders). Gated to siege.
  groundHeightFn,
  // Mini Earth: multiplies FLY (god-mode) speed only. The planet is 400,750 units around, so
  // the normal 8-16 units/s would take hours to cross it; the globe map scales this with
  // altitude so one set of controls works both in orbit and just above the ground. Returns 1
  // (no change) on every other map, so this is inert unless a globe map supplies it.
  flySpeedScale,
  // Mini Earth: the local UP at the camera. When supplied, the camera's rotation is built in that
  // frame instead of around world Y.
  //
  // The engine composes the camera as Euler(pitch, yaw, 0, 'YXZ'), i.e. yaw about WORLD Y. That is
  // correct on a flat map and wrong on a sphere everywhere except the north pole: yawing about
  // world Y while standing over Texas swings the camera around an axis 60 degrees off local up,
  // which rolls the horizon instead of turning. Mouse-left/right should rotate about the axis
  // running from the planet centre through the camera.
  cameraUpFn,
  // Mini Earth: a PLANET-CENTRIC movement basis. The mover is otherwise world-axis aligned:
  // forward is horizontal in world XZ and Q/Z move along world +Y. That is correct on a flat map
  // and wrong everywhere on a sphere except the north pole. Standing over Houston, world "up" is
  // 60 degrees off local up, so W pushed you 87% straight up and Q was 87% sideways.
  // When supplied, this returns the local tangent frame (forward/right along the surface, up
  // radially away from the planet centre) and the mover uses it instead. Omitted everywhere else,
  // so no other map changes by a single float.
  moveBasis,
}: FirstPersonControlsProps & { onGodModeChange?: (enabled: boolean) => void; forceFloat?: boolean; groundHeightFn?: (x: number, z: number) => number | null; flySpeedScale?: () => number; moveBasis?: () => { fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } | null; cameraUpFn?: () => THREE.Vector3 | null }) {
  const { camera, gl } = useThree();
  // Siege maps pass groundHeightFn — there is NO fortress there, so all fortress-position
  // systems (no-fire safe zone, vault) must be OFF (they live at the origin = siege spawn).
  const isSiege = !!groundHeightFn;
  const { raycastMeshes } = useRaycaster();
  const isLocked = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  // Third-person (siege): the true player eye saved before the render pull-back, the current (lerped)
  // pull-back distance, and whether the eye has been captured yet. All no-ops until Alt+wheel zooms out.
  const tpEye = useRef(new THREE.Vector3());
  const tpFwd = useRef(new THREE.Vector3());
  const tpRender = useRef(new THREE.Vector3());   // where WE left the render camera last frame
  const tpCurrent = useRef(0);
  const tpEyeSet = useRef(false);
  const keys = useRef({
    w: false, s: false, a: false, d: false,
    shift: false, space: false, r: false, ctrl: false,
    previouslyCtrl: false, rightMouse: false,
    q: false, z: false, e: false
  });
  // Glide mode: activated by pressing G while falling, auto-deactivates on landing
  const glideActiveRef = useRef(false);   // computed glide state (held-G AND airborne), for HUD
  const gKeyHeldRef = useRef(false);       // is the G key physically held right now

  // Grenade ready state mirror — synced from parent prop so the
  // click handler can read it without async state. Parent (Fortress)
  // owns the actual flag because it depends on inventory + equipped
  // slot lookups.

  // Jet Boost system: 1 boost per 3 levels, recharges every 60 seconds
  const jetBoostMaxRef = useRef(0);
  const jetBoostAvailRef = useRef(0);
  const jetBoostNextRefillRef = useRef(0);
  const jetBoostRequestRef = useRef(false);
  const boostFlameUntilRef = useRef(0);   // while now < this, the self-avatar shows the jet-boot flames
  const lastGroundedAtRef = useRef(0);    // last time we were on the ground (ms) — physics coyote time
  const spaceKeyEdgeRef = useRef(false); // Edge detection for space key
  // Rocket Belt forward-boost: discrete bursts (each 0.25s of fast-forward), regen 1/5s.
  const beltBurstsRef = useRef(0);          // available bursts
  const beltBurstRemainingRef = useRef(0);  // seconds left in the current burst
  const beltRegenAccumRef = useRef(0);      // seconds accumulated toward the next regen
  const beltLastMaxRef = useRef(0);         // last seen max (detect change → cap / initial grant)
  const beltHudThrottleRef = useRef(0);     // throttle HUD store writes
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
  // Siege Worlds float: no terrain collision yet, so noclip-fly the player.
  useEffect(() => {
    if (forceFloat) { godModeRef.current = true; setGodModeEnabled(true); onGodModeChange?.(true); }
  }, [forceFloat]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sticky admin: once confirmed admin/superadmin this session, latch it so a
  // transient roles refetch/clear can't silently disable admin keybinds
  // (God Mode toggle, Shift+E super-sprint) mid-play.
  const adminEverRef = useRef(false);
  const onGround = useRef(true);
  /** An in-progress ledge climb. While set, the climb owns the player's
   *  position and normal movement stands down. */
  // Parkour owns its own state — see src/features/parkour/useParkour.ts.
  const parkour = useParkour();
  const lastSiegeGround = useRef<{ x: number; z: number; y: number } | null>(null); // prev-frame terrain pos for the slope limit
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
  const spinVelRef = useRef(0);   // yaw angular velocity (rad/s) from a Spintroll fling — decays

  // Moving-platform (walapa) ride: which platform we're attached to + its last pos.
  const currentWalapaIdRef = useRef<string | null>(null);
  const walapaLastPosRef = useRef(new THREE.Vector3());

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
  const lastFireTimeRight = useRef(0);   // RIGHT pistol's independent cooldown clock (dual-wield)
  // Right-pistol "hold to zoom, release fires a 2nd shot": press fires once; if held past
  // RIGHT_ADS_HOLD_MS we zoom (ADS); releasing after a zoom fires the second shot.
  const rmbDownAtRef = useRef(0);        // when the right button went down (0 = up)
  const rmbZoomedRef = useRef(false);    // did this right-hold engage the zoom?
  const rmbFiredRightRef = useRef(false);// did this right-press fire the right pistol on down?
  const rmbFlamingRef = useRef(false);   // is the RIGHT-hand flame glove flaming (right button held)?
  const FIRE_RATE_LIMIT = 150;

  // Reset the clip whenever the equipped weapon changes (full clip on equip/swap).
  const activeWeaponForAmmo = useActiveWeapon();
  useEffect(() => {
    resetAmmoForWeapon(activeWeaponForAmmo?.ammoClipAmount ?? null);
  }, [activeWeaponForAmmo]);
  
  // Tree chopping state - Minecraft style hold-to-chop
  const CHOP_INTERVAL_MS = 350; // Time between chops (like Minecraft)
  const CHOPS_REQUIRED = 5; // Number of chops to trigger modal
  const leftMouseDownRef = useRef(false);
  // Automatic-weapon hold-to-fire (Phase 1): true while the fire button is held
  // on an is_automatic gun. The frame loop repeat-fires at the weapon's cooldown.
  const autoFiringRef = useRef(false);
  // Shared single-shot fire fn, exposed via ref so the frame loop (no deps) can
  // call the same firing path the click handler uses.
  const fireWeaponShotRef = useRef<(weapon?: ActiveWeaponStats | null, clock?: React.MutableRefObject<number>) => void>();
  // Phase 2 camera recoil: transient view kick (radians) ADDED on top of the
  // player's pitch/yaw and recovered toward 0 each frame, so it never corrupts
  // the underlying aim. Positive pitch = up.
  const recoilPitchRef = useRef(0);
  const recoilYawRef = useRef(0);
  // Phase 3 ADS: true while aiming down sights (hold right mouse). Drives FOV
  // zoom, reduced recoil/spread, and the scope overlay.
  const isAimingRef = useRef(false);
  // FOV is only managed DURING an aim cycle so we never drift the resting FOV
  // (the camera spawns at 70; getBaseFov defaults to 75 — don't force it).
  // restFovRef = the FOV to return to (captured when aiming starts); adsActiveRef
  // = an aim transition is in progress (zooming in, or easing back out).
  const restFovRef = useRef(0);
  const adsActiveRef = useRef(false);
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
    playerLevelRef.current = playerLevel;
  }, [playerLevel]);

  const gridInitialized = useRef(false);
  
  // Apply knockback function - can be called externally via prop or internally
  // IMPORTANT: Only applies horizontal knockback (X/Z) - vertical is ignored to prevent sky launches
  const applyKnockback = useCallback((direction: THREE.Vector3, distance: number) => {
    // God mode: no knockback from ANY source (damage hits + direct monster pushes both route
    // through here). Monsters still see + swing at the player; the player just won't budge.
    if (godModeRef.current) return;
    // Calculate velocity needed to travel 'distance' over ~0.2 seconds
    const secondsToApply = 0.2;
    // Only apply horizontal knockback - set Y to 0 to prevent accumulation
    knockbackVelRef.current.x += direction.x * (distance / secondsToApply);
    knockbackVelRef.current.z += direction.z * (distance / secondsToApply);
    // Explicitly keep Y at 0 - no vertical knockback
    knockbackVelRef.current.y = 0;
    // HARD CAP the velocity: huge / stacked knockbacks (e.g. a Spintroll zoom-hit) were flinging
    // the player THROUGH the world (tunneling) into the void. Clamp so a single step can't skip
    // collision, no matter how big or how many hits stack.
    const MAX_KB = 42; // m/s
    const len = Math.hypot(knockbackVelRef.current.x, knockbackVelRef.current.z);
    if (len > MAX_KB) {
      const k = MAX_KB / len;
      knockbackVelRef.current.x *= k;
      knockbackVelRef.current.z *= k;
    }
  }, []);
  
  // Expose applyKnockback globally for the universal damage system
  // This is always set - the damage pipeline in usePlayerHealth uses it
  useEffect(() => {
    (window as any).__applyPlayerKnockback = applyKnockback;
    return () => {
      delete (window as any).__applyPlayerKnockback;
    };
  }, [applyKnockback]);

  // Spintroll fling: impart a decaying yaw spin so the whole world whirls, then settles.
  useEffect(() => {
    (window as any).__applyPlayerSpin = (revPerSec: number, dir: number) => {
      // SETS (never accumulates) and is clamped to ≤2.5 rev/s, so it always decays out — never a
      // runaway permanent spin you can't recover from.
      const v = Math.max(-2.5, Math.min(2.5, revPerSec)) * Math.sign(dir || 1) * Math.PI * 2;
      spinVelRef.current = v;
    };
    return () => { delete (window as any).__applyPlayerSpin; };
  }, []);

  // Lets the Siege "Jump To" apply a saved view ANGLE (yaw/pitch). Sets the controller's own refs
  // so it sticks — setting camera.rotation alone gets overwritten on the next mouse move.
  useEffect(() => {
    (window as any).__siegeSetView = (yawRad: number, pitchRad = 0) => {
      yaw.current = yawRad; pitch.current = pitchRad; needsCameraUpdate.current = true;
      console.warn(`[LOOKSNAP] __siegeSetView pitch=${pitchRad?.toFixed?.(3)} yaw=${yawRad?.toFixed?.(3)} (programmatic view set — fired during a spawn = the cause)`);
    };
    return () => { delete (window as any).__siegeSetView; };
  }, []);

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
    if (!respawnPosition) return;
    velocity.current.set(0, 0, 0);
    knockbackVelRef.current.set(0, 0, 0);
    // Siege challenge death: the player stays where they FELL for the defeat experience — don't yank
    // them to the world spawn (that was the "dropped out of SciFi City" bug). Normal DreadRoot
    // respawns still teleport.
    if (!isSiegePlayerDead()) camera.position.copy(respawnPosition);
    onRespawnComplete?.();
  }, [respawnPosition, camera, onRespawnComplete]);
  
  // Collision boxes for fortress walls only (block colliders are now managed by useChunkLoader)
  const collidersArrayRef = useRef<THREE.Box3[]>([]);
  
  // Get fortress colliders once - they're static. NONE in siege (no fortress there).
  useMemo(() => {
    collidersArrayRef.current.length = 0;
    if (isSiege) return;
    const fortressColliders = createFortressColliders();
    for (let i = 0; i < fortressColliders.length; i++) {
      collidersArrayRef.current.push(fortressColliders[i]);
    }
  }, [isSiege]);
  
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
          dlog('controls', '[FortressControls] Ctrl+I pressed, userRoles:', userRoles);
          if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
            event.preventDefault();
            dlog('controls', '[FortressControls] Toggling inspector mode');
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
        // Plain Y no longer arms eggs — eggs equip into a hand and throw with G (unified
        // with grenades). Only Ctrl+Y (yodel, handled above) uses the Y key now.
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
        // SW-style reload: if the gun is out and its clip isn't full, R reloads
        // (matches Siege Worlds). Otherwise R draws/holsters the gun as before.
        if (showCrosshairs && canReload()) {
          const awR = getActiveWeapon();
          beginReload();
          triggerAction('reload');
          playSpatialSound(getSoundUrl(awR?.reloadSound ?? 'rifle_reload', '/rifle_reload.mp3'), 0, { baseVolume: 0.5 });
          setTimeout(() => finishReload(), (awR?.reloadTime ?? 2) * 1000);
          break;
        }
        // Siege: R reloads (above) and can DRAW the weapon when it's away, but must NEVER holster —
        // a full clip + R was accidentally putting the gun away. (Holster/draw toggle is on X.)
        if (isSiege) {
          if (!showCrosshairs && !blockPlacementMode) {   // weapon is away → draw it
            onModeChange('shooting');
            playSpatialSound(getSoundUrl('pistol_cock', '/pistol_cocking_sound.mp3'), 0, { baseVolume: 0.5 });
          }
          break;   // weapon already out (+full) → do nothing; R never holsters
        }
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
          dlog('controls', '[KeyHandler] T+2 detected, switching to wide_planting');
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
          dlog('controls', '[KeyHandler] T+3 detected, switching to fungal_planting');
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
          if (isQASuppressed()) break;   // trailing digit from a spawn command — ignore
          const slot = parseInt(event.code.replace('Digit', ''));
          event.preventDefault();
          onUseHotbarSlot(slot);
        }
        break;
      case 'KeyB':
        // Block building is a voxel (Dreadroot) feature — Siege Worlds has no blocks, so B does
        // nothing there (it was toggling an irrelevant "block mode" + toast).
        if (!gameUsesVoxels(getActiveGame())) break;
        // Plain B toggles block-building mode. SHIFT+B opens the Fortress Builder
        // (handled in FortressBuilderPanel) — don't also flip building mode; Ctrl/Cmd+B
        // are browser-reserved.
        if (event.shiftKey || event.ctrlKey || event.metaKey) break;
        if (blockPlacementMode) {
          onModeChange(null);
        } else {
          onModeChange('building');
        }
        break;
      case 'KeyT':
        // Plain T is the chat key now (handled by the chat overlay). Tree planting
        // moved to SHIFT+T — Ctrl/Cmd+T are reserved by the browser (new tab).
        if (!event.shiftKey) break;
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
      case 'Backquote': // ` or ~ key for God Mode (admin/superadmin)
        // Plain ` only — Shift+` is the object-editor (Arrange) toggle, so God Mode no longer
        // also pops the Arrange menu.
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) break;
        // Allow toggling if admin now, ever-was-admin this session (sticky —
        // survives a transient roles clear), OR if God Mode is already ON (you
        // must always be able to turn it OFF).
        if (godModeRef.current || adminEverRef.current ||
            userRoles.includes('admin') || userRoles.includes('superadmin')) {
          // Spherical world: the flat mover has no valid ground here (its sampler is XZ->Y and
          // returns null, so it falls back to SWW's sea level and drops you through the planet).
          // Leaving god mode means "become the character", which is the walk controller's job.
          if (cameraUpFn && godModeRef.current) {
            enterKaijuWalkMode(camera);
            event.preventDefault();
            break;
          }
          godModeRef.current = !godModeRef.current;
          setGodModeEnabled(godModeRef.current);
          onGodModeChange?.(godModeRef.current);
        }
        break;
      case 'F9': // Debug: show nearby colliders and clear orphans
        if (userRoles.includes('admin') || userRoles.includes('superadmin')) {
          event.preventDefault();
          dlog('controls', `[Debug] Camera at: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`);
          dlog('controls', `[Debug] World Colliders: ${worldCollisionGrid.size}, Entity Colliders: ${entityCollisionGrid.size}`);
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
          dlog('controls', '[Debug] EMERGENCY: Clearing both collision grids!');
          worldCollisionGrid.clear();
          entityCollisionGrid.clear();

          // Immediately reinsert fortress colliders (block colliders are reinserted by the chunk loader listener).
          resetFortressGridState();
          createFortressColliders();

          const newWorldSize = worldCollisionGrid.size;
          dlog('controls', `[Debug] Grids cleared. World was ${oldWorldSize}, now ${newWorldSize}. Entity was ${oldEntitySize}, now 0.`);
          
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
        // Plain G is dual-purpose: HOLD it in the air to glide (handled per
        // frame from gKeyHeldRef so it engages reliably even if you held G
        // before walking off a ledge), or tap it on the ground to arm a
        // grenade (parent owns inventory/equipped state + slot selection).
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        gKeyHeldRef.current = true;
        if (event.repeat) break;
        // A TAP throws one throwable from the quick bar. HOLDING G in the air
        // is still the glide, so a tap only throws with your feet on the ground
        // (or in god mode). The parent decides which throwable and spends it.
        if (onGround.current || godModeRef.current) {
          if (onThrowPress && !onThrowPress()) flashCenter('NO GRENADES — PUT ONE IN YOUR QUICK BAR');
        }
        break;
      case 'KeyX':
        // Siege: holster / draw the weapon (X, since R is reload-only). The self-avatar plays the
        // put-away / draw animation off the resulting weapon-out state.
        if (!isSiege || event.repeat || blockPlacementMode) break;
        {
          const drawing = !showCrosshairs;
          onModeChange(drawing ? 'shooting' : null);
          playSpatialSound(getSoundUrl(drawing ? 'pistol_cock' : 'pistol_holster', drawing ? '/pistol_cocking_sound.mp3' : '/holster_pistol_sound.mp3'), 0, { baseVolume: 0.5 });
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
        if (event.repeat) break;   // one pickup/harvest per press — repeats double-fired egg pickup
        // Harvest nearest fruit (egg pickup takes priority, handled in the callback)
        if (onHarvestFruitRef.current) {
          onHarvestFruitRef.current();
        }
        break;
      case 'KeyV':
        // V opens the vault near the fortress back-wall (DreadRoot). In Siege the lobby has two
        // proximity zones — vault + market (~18m apart, never overlap) — so V opens whichever the
        // player is standing in. No modifier — Cmd/Ctrl+V is left alone (browser paste).
        if (event.metaKey || event.ctrlKey || event.altKey) break;
        if (isSiege) {
          if (getVaultInRange() && onOpenVault) { event.preventDefault(); onOpenVault(); }
          else if (getMarketInRange() && onOpenMarketplace) { event.preventDefault(); document.exitPointerLock?.(); onOpenMarketplace(); }
        } else if (onOpenVault) {
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
      case 'KeyG':
        gKeyHeldRef.current = false; // release glide
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
  const prevAppliedPitchDbg = useRef(0);  // LOOKSNAP debug: catch sudden vertical-look jumps + attribute them

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
    if (Math.abs(movementY) > 120) console.warn(`[LOOKSNAP] large mouse dY=${movementY} dX=${movementX} (a spike here right when the view jumps = the cause)`);

    const maxPitch = Math.PI / 2 - 0.01;
    pitch.current = Math.max(-maxPitch, Math.min(maxPitch, pitch.current));
    needsCameraUpdate.current = true;
  }, []);
  
  handleMouseMoveRef.current = handleMouseMove;

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!isLocked.current) return;
    // Alt+wheel = third-person camera zoom, in BOTH games now. Wheel down =
    // pull back, up = zoom in to first person. Alt rather than plain wheel so
    // it never fights block/seed cycling, which owns the bare wheel here.
    if (event.altKey) { event.preventDefault(); nudgeTPDist(event.deltaY > 0 ? 1 : -1); return; }
    if (blockPlacementMode) {
      event.preventDefault();
      onCycleBlock(event.deltaY > 0 ? 'next' : 'prev');
    } else if (treePlacementMode) {
      event.preventDefault();
      onCycleSeed(event.deltaY > 0 ? 'next' : 'prev');
    }
  }, [blockPlacementMode, treePlacementMode, onCycleBlock, onCycleSeed]);
  
  handleWheelRef.current = handleWheel;

  // Fire ONE round from the equipped weapon. Self-gated by the weapon's
  // shootCooldown (so the auto-fire frame loop can call it every frame and it
  // only fires when due). Shared by the click handler (semi-auto) and the
  // frame-loop repeat (automatic). No-fire-zone, ammo, sound + consume all here.
  // Fire a hand's weapon. Defaults to the LEFT hand (equip slot 1 = getActiveWeapon, shared
  // `lastFireTime`). The RIGHT pistol passes its own stats + cooldown clock so the two hands
  // fire on independent cooldowns; the AMMO pool stays shared (one pool for now).
  const fireWeaponShot = useCallback((weapon?: ActiveWeaponStats | null, fireClock?: React.MutableRefObject<number>) => {
    if (!onShoot) return;
    const aw = weapon !== undefined ? weapon : getFireWeapon();   // left-click: E1, else fall back to E2
    const clock = fireClock ?? lastFireTime;
    // A weapon must be EQUIPPED to shoot — no gun = no fire (no default shot), flash a
    // warning each attempt. (Flame glove = non-gun → flame path, never reaches here.)
    if (!aw) { if (!getFlameGlove()) flashCenter('NO WEAPON EQUIPPED'); return; }
    // No-fire zone (FSZ + 1 chunk buffer) → dry click, no shot. DreadRoot only — no fortress in siege.
    if (!isSiege && isPointInNoFireZone(camera.position.x, camera.position.y, camera.position.z)) {
      playSpatialSound(getSoundUrl('empty_gun_click', '/empty_gun_click.mp3'), 0, { baseVolume: 0.5 });
      return;
    }
    const now = Date.now();
    const cooldownMs = aw ? aw.shootCooldown * 1000 : FIRE_RATE_LIMIT;
    if (now - clock.current < cooldownMs) return;
    if (!canFire()) {
      if (!getAmmo().reloading) {
        playSpatialSound(getSoundUrl(aw?.emptySound ?? 'empty_gun_click', '/empty_gun_click.mp3'), 0, { baseVolume: 0.5 });
      }
      return;
    }
    clock.current = now;
    shootDirectionRef.current.set(0, 0, -1);
    shootDirectionRef.current.applyQuaternion(camera.quaternion);
    shootDirectionRef.current.normalize();
    shootOriginRef.current.copy(camera.position);

    // Phase 5 — spread + multi-pellet. Fire bulletsPerTap pellets, each offset
    // within the weapon's spread cone. Spread tightens to zero when aiming
    // (except shotguns/multi-pellet, which always spread) and doubles while
    // moving (hip-fire run-and-gun is inaccurate, like SWU).
    //
    // IMPORTANT: weapon_stats.horizontal_spread/vertical_spread are SWU
    // SCREEN-SPACE PIXEL offsets (Unity applies them via ScreenPointToRay), NOT
    // degrees. Convert px → ray tangent offset through the camera focal length
    // so accuracy matches SWU. focal = (viewportHeightPx/2) / tan(vFOV/2);
    // tan(angle) = pixels / focal.
    const pellets = Math.max(1, aw?.bulletsPerTap ?? 1);
    const isShotgun = pellets > 1;
    const movingSq = velocity.current.x * velocity.current.x + velocity.current.z * velocity.current.z;
    let spreadScale = 1;
    if (isAimingRef.current && !isShotgun) spreadScale = 0;       // aimed = pinpoint
    else if (movingSq > 1) spreadScale = 2;                       // moving = wide
    const pcam = camera as THREE.PerspectiveCamera;
    const vFov = (pcam.isPerspectiveCamera ? pcam.fov : 70) * Math.PI / 180;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const focalPx = (Math.max(1, viewportH) / 2) / Math.tan(vFov / 2);
    const hSpreadPx = (aw?.horizontalSpread ?? 0) * spreadScale;
    const vSpreadPx = (aw?.verticalSpread ?? 0) * spreadScale;
    // Safety: cap the tangent offset so a stray/huge DB value can never send a
    // bullet sideways or backwards (~0.3 tan ≈ 17°).
    const MAX_TAN = 0.3;

    // Recoil plays ONCE per trigger pull. Firing it per pellet would queue
    // eight overlapping recoils for a shotgun.
    triggerAction('shoot');

    if (pellets === 1 && hSpreadPx === 0 && vSpreadPx === 0) {
      onShoot(shootOriginRef.current, shootDirectionRef.current);
    } else {
      const base = shootDirectionRef.current;
      const right = new THREE.Vector3().crossVectors(base, _spreadWorldUp).normalize();
      const realUp = new THREE.Vector3().crossVectors(right, base).normalize();
      for (let i = 0; i < pellets; i++) {
        const dir = new THREE.Vector3().copy(base);
        if (hSpreadPx > 0 || vSpreadPx > 0) {
          const hx = THREE.MathUtils.clamp(((Math.random() * 2 - 1) * hSpreadPx) / focalPx, -MAX_TAN, MAX_TAN);
          const vy = THREE.MathUtils.clamp(((Math.random() * 2 - 1) * vSpreadPx) / focalPx, -MAX_TAN, MAX_TAN);
          dir.addScaledVector(right, hx);
          dir.addScaledVector(realUp, vy);
          dir.normalize();
        }
        onShoot(shootOriginRef.current, dir);
      }
    }

    const fireKey = aw?.fireSound ?? 'gunshot';
    playSpatialSound(getSoundUrl(fireKey, '/space_gunshot.mp3'), 0, { baseVolume: 0.3 });
    consumeAmmo();

    // Phase 2 — camera recoil: kick the view UP a touch + a small random
    // horizontal jitter; the frame loop recovers it. Per-weapon overrides come
    // from weapon_stats (camera_recoil_pitch/yaw) with sensible defaults so it
    // works before those columns are filled. Reduced while aiming (ADS).
    const DEG = Math.PI / 180;
    const pitchKickDeg = aw?.recoilPitch ?? 1.1;
    const yawKickDeg = aw?.recoilYaw ?? 0.45;
    const adsScale = isAimingRef.current ? (aw?.adsRecoilScale ?? 0.4) : 1;
    recoilPitchRef.current += pitchKickDeg * DEG * adsScale;
    recoilYawRef.current += (Math.random() * 2 - 1) * yawKickDeg * DEG * adsScale;
    needsCameraUpdate.current = true;
  }, [camera, onShoot]);
  fireWeaponShotRef.current = fireWeaponShot;

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
      // Admins/superadmins may sculpt the fortress: bypass the fortress + waterfall
      // no-build zones (overlap/floating safety still enforced).
      const canSculptFortress = userRolesRef.current?.some(
        (r: string) => r === 'admin' || r === 'superadmin'
      );
      // Use fast voxel raycast - ZERO allocations, O(ray length)
      const placementResult = calculatePlacementFast(
        camera,
        existingBlocks || [],
        5,
        canSculptFortress
      );
      
      if (placementResult.isValid) {
        // Create Vector3 for callback (only allocation on successful placement)
        const position = new THREE.Vector3(
          placementResult.x,
          placementResult.y,
          placementResult.z
        );
        onBlockPlace(position);

        // If we placed a block inside our own column (e.g. at our feet), stand on
        // TOP of it instead of getting embedded. Deterministic at placement time —
        // the generic per-frame push-out can mis-pick a sideways/down direction.
        const pHeight = keys.current.ctrl ? 0.8 : 1.6; // crawling : standing
        const pRadius = 0.3;
        const blockTop = placementResult.y + 1;
        const feetY = camera.position.y - pHeight;
        const cx = placementResult.x + 0.5;
        const cz = placementResult.z + 0.5;
        const horizOverlap =
          Math.abs(camera.position.x - cx) < 0.5 + pRadius &&
          Math.abs(camera.position.z - cz) < 0.5 + pRadius;
        const vertOverlap = blockTop > feetY && placementResult.y < camera.position.y;
        if (horizOverlap && vertOverlap) {
          camera.position.y = blockTop + pHeight + 0.005;
          velocity.current.y = 0;
          onGround.current = true;
        }
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
    } else if (showCrosshairs && onShoot) {
      // Throwables never interrupt the gun now: G throws, left-click always
      // fires. Previously an armed grenade made a rifle's left-click a no-op
      // until you threw it or right-clicked to put the pin back.
      // A LEFT-hand flame glove uses continuous hold on the left button, not click-to-fire.
      if (getFlameGlove()?.hand === 'L') return;

      // Skip normal shot if pentabullet is charging (>1s hold)
      if (pentabulletChargeRef.current >= 1.0) {
        return; // Will fire pentabullet or cancel on mouseup
      }

      // Automatic weapons fire on mousedown + frame-loop repeat (hold-to-fire),
      // NOT on the click event — otherwise a tap would double-fire.
      if (getFireWeapon()?.isAutomatic) return;

      fireWeaponShot();
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

    // Check if player is in no-fire zone (FSZ + 1 chunk buffer) — DreadRoot only.
    if (!isSiege && isPointInNoFireZone(camera.position.x, camera.position.y, camera.position.z)) {
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

      // ── Right-click priority ──
      // Grenade disarm used to sit at the top of this list, so right-click
      // meant "put the pin back" instead of "aim" whenever a grenade happened
      // to be armed — the same button doing a different job depending on
      // invisible state. There is no armed state any more, so the list starts
      // at the flame glove and ends at aiming.
      //
      // 1. A RIGHT-hand flame glove → right button starts the flamethrower (held). The left
      //    hand's pistol is unaffected.
      if (getFlameGlove()?.hand === 'R' && showCrosshairs && !blockPlacementMode && !treePlacementMode && !widePlacementMode) {
        onFlameStart?.();
        rmbFlamingRef.current = true;
        event.preventDefault();
        return;
      }
      // 2. DUAL-WIELD — right-click fires the RIGHT gun (hold-to-zoom + release-2nd-shot)
      //    when the LEFT hand is occupied (gun OR glove), so left-click is taken by the
      //    left hand. With a lone gun, left-click fires it and right-click stays ADS.
      const rw = (getActiveWeapon() || getFlameGlove()?.hand === 'L') ? getRightWeapon() : null;
      if (rw && showCrosshairs && !blockPlacementMode && !treePlacementMode && !widePlacementMode) {
        fireWeaponShotRef.current?.(rw, lastFireTimeRight);
        rmbDownAtRef.current = Date.now();
        rmbZoomedRef.current = false;
        rmbFiredRightRef.current = true;
        event.preventDefault();
        return;
      }

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
          dlog('controls', inspectData.rawInfo);

          // Async Supabase (server-truth) check — logs the real DB + chunk-cache state so we can
          // see whether a block actually persisted and whether the chunk cache is stale.
          if (currentWorldId) {
            (async () => {
              try {
                const [pbRes, cvRes, cbRes] = await Promise.all([
                  (supabase.from('placed_blocks') as any)
                    .select('id, block_type, world_id, world_number, chunk_x, chunk_z, created_at, user_id')
                    .eq('world_id', currentWorldId).eq('position_x', bx).eq('position_y', by).eq('position_z', bz).maybeSingle(),
                  (supabase.from('chunk_versions') as any)
                    .select('version').eq('world_id', currentWorldId).eq('chunk_x', chunkX).eq('chunk_z', chunkZ).maybeSingle(),
                  (supabase.from('chunk_blobs') as any)
                    .select('version, blob').eq('world_id', currentWorldId).eq('chunk_x', chunkX).eq('chunk_z', chunkZ).maybeSingle(),
                ]);
                const pb = (pbRes as any).data;
                const blob = (cbRes as any).data?.blob;
                const blobArr = Array.isArray(blob) ? blob : null;
                const blobHas = blobArr ? blobArr.some((b: any) => b.position_x === bx && b.position_y === by && b.position_z === bz) : null;
                const liveV = (cvRes as any).data?.version ?? null;
                const blobV = (cbRes as any).data?.version ?? null;
                dlog('controls', '[BlockInspector:SUPABASE]', JSON.stringify({
                  placed_blocks_row: pb ? {
                    block_type: pb.block_type, world_id: pb.world_id, world_number: pb.world_number,
                    chunk_x: pb.chunk_x, chunk_z: pb.chunk_z, user_id: pb.user_id, created_at: pb.created_at,
                  } : 'NOT IN DB',
                  chunk_live_version: liveV,
                  chunk_blob_version: blobV,
                  chunk_blob_is_stale: (liveV ?? 0) > (blobV ?? -1),
                  chunk_blob_block_count: blobArr ? blobArr.length : null,
                  chunk_blob_has_this_block: blobHas,
                }, null, 2));
              } catch (e) {
                console.error('[BlockInspector:SUPABASE] query failed:', e);
              }
            })();
          }

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
                dlog('controls', '[BlockInspector] IndexedDB check complete:', match ? 'FOUND' : 'NOT FOUND');
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

      // Start flame glove, automatic rapid-fire, or pentabullet charge (shooting mode).
      if (showCrosshairs && !blockPlacementMode && !treePlacementMode && !widePlacementMode) {
        if (getFlameGlove()?.hand === 'L' && onFlameStart) {
          // LEFT-hand flame glove → left button starts the flamethrower
          onFlameStart();
        } else if (getFireWeapon()?.isAutomatic) {
          // Automatic weapon: hold to rapid-fire. Fire the first round now; the
          // frame loop repeats at the weapon's cooldown. No pentabullet charge.
          autoFiringRef.current = true;
          fireWeaponShotRef.current?.();
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
      // Stop the RIGHT-hand flame glove (right button released).
      if (rmbFlamingRef.current) { onFlameStop?.(); rmbFlamingRef.current = false; }
      // Right-pistol hold release: if the hold engaged the zoom, releasing fires a SECOND
      // right-pistol shot; then end the zoom and reset the hold state.
      if (rmbFiredRightRef.current) {
        if (rmbZoomedRef.current) fireWeaponShotRef.current?.(getRightWeapon(), lastFireTimeRight);
        setAiming(false);
        rmbDownAtRef.current = 0;
        rmbZoomedRef.current = false;
        rmbFiredRightRef.current = false;
      }
    }
    if (event.button === 0) {
      // Stop the LEFT-hand flame glove (left button released).
      if (getFlameGlove()?.hand === 'L' && onFlameStop) onFlameStop();

      // Check for pentabullet release
      if (pentabulletChargeRef.current >= 5.0 && showCrosshairs) {
        firePentabullet();
      } else if (pentabulletPhaseRef.current !== 'idle') {
        // Incomplete charge - cancel and fire normal shot
        cancelPentabulletCharge();
      }

      leftMouseDownRef.current = false;
      autoFiringRef.current = false;   // stop automatic rapid-fire
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
      // Release hold-to-fire too — when a menu/result panel takes pointer lock, the browser stops
      // delivering mouseup, so an automatic weapon would keep frame-loop-firing and the gunshot sound
      // machine-guns the same fraction forever (the "stuck sound on game end").
      leftMouseDownRef.current = false;
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
    // NOT passive: `wheel` on document defaults to passive in Chrome, which
    // makes preventDefault a no-op and lets the browser act on the same
    // gesture the game is using.
    document.addEventListener('wheel', stableWheelListener, { passive: false });
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
  // Frame-loop mirror of the flame-glove flag (used to disable chopping when a
  // weapon is equipped — see the chop gate below).
  const isFlameGloveSelectedRef = useRef(isFlameGloveSelected);
  
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
  useEffect(() => { isFlameGloveSelectedRef.current = isFlameGloveSelected; }, [isFlameGloveSelected]);


  // Movement and collision frame loop - register with centralized loop
  useEffect(() => {
    const unregister = frameLoop.register('controls', (delta) => {
      // SW spawn cinematic owns the camera — stand down completely (no input/move/rotate/gravity).
      // Siege-only flag (never set in voxel play), so this is a no-op in DreadRoot. Zero velocity so
      // accumulated gravity doesn't jolt the player on handoff back to the controller.
      if (isSiegeIntroActive()) { velocity.current.set(0, 0, 0); return; }
      // Mini Earth WALK mode: KaijuWalkController drives the camera third-person around the
      // simulated body. Two movers writing one camera is the failure mode here, so this one
      // yields entirely, exactly as it does for the spawn cinematic above.
      if (isKaijuWalkActive()) { velocity.current.set(0, 0, 0); return; }
      // Third-person (siege): smoothly track the target pull-back distance, then RESTORE the true eye
      // (undoing last frame's render offset) so all movement/collision/aim below use the real player
      // position. The pull-back is re-applied at the very END of this loop. First-person (0) = no-op.
      {
        // Snap straight to first person when the target is 0 (a map jump / full zoom-in) so the camera
        // never lingers pulled-back inside walls at the new spawn; otherwise ease toward the target.
        if (getTPDist() === 0) tpCurrent.current = 0;
        else { tpCurrent.current += (getTPDist() - tpCurrent.current) * Math.min(1, delta * 10); if (tpCurrent.current < 0.02) tpCurrent.current = 0; }
        // Restore the eye ONLY if the camera is still exactly where WE left it (our render offset). If
        // ANYTHING else moved it since — a Cmd-J teleport, a spawn/respawn, god-mode fly — treat that
        // as the new eye instead of yanking it back to a stale one.
        if (tpCurrent.current > 0 && tpEyeSet.current && camera.position.distanceToSquared(tpRender.current) < 1e-4) {
          camera.position.copy(tpEye.current);
        } else {
          tpEyeSet.current = false;
        }
      }
      // Note: useFrameCallCount only tracked in master loop now

      // Apply camera rotation if needed
      // Phase 2 — recover camera recoil toward zero (frame-rate independent),
      // and keep re-applying the camera while any recoil offset remains.
      if (recoilPitchRef.current !== 0 || recoilYawRef.current !== 0) {
        const k = 1 - Math.exp(-12 * delta);   // ~12/s recovery rate
        recoilPitchRef.current -= recoilPitchRef.current * k;
        recoilYawRef.current -= recoilYawRef.current * k;
        if (Math.abs(recoilPitchRef.current) < 1e-4) recoilPitchRef.current = 0;
        if (Math.abs(recoilYawRef.current) < 1e-4) recoilYawRef.current = 0;
        needsCameraUpdate.current = true;
      }
      if (needsCameraUpdate.current) {
        // Clamp the recoil-augmented pitch to just under ±90° so a kick while
        // aiming near vertical can't flip the camera over the pole.
        const PITCH_LIMIT = Math.PI / 2 - 0.01;
        const appliedPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current + recoilPitchRef.current));
        // LOOKSNAP debug: any big single-frame vertical-look jump → log it + its source so we can tell
        // mouse vs recoil vs programmatic. (~0.5 rad ≈ 28°; normal looking never jumps that in one frame.)
        if (Math.abs(appliedPitch - prevAppliedPitchDbg.current) > 0.5) {
          const lm = lastMovements.current[lastMovements.current.length - 1];
          console.warn(`[LOOKSNAP] pitch jumped ${(prevAppliedPitchDbg.current).toFixed(2)}→${appliedPitch.toFixed(2)} | base pitch=${pitch.current.toFixed(2)} recoil=${recoilPitchRef.current.toFixed(2)} | last mouse dY=${lm ? lm.y : 'n/a'}  (recoil big=weapon/kick · base+big dY=mouse · base jumped+tiny dY=programmatic)`);
        }
        prevAppliedPitchDbg.current = appliedPitch;
        const localUp = cameraUpFn ? cameraUpFn() : null;
        if (localUp) {
          // Spherical world: build the orientation in the LOCAL frame so yaw turns about local up
          // and the horizon stays level wherever you stand.
          const y = yaw.current + recoilYawRef.current;
          _cuEast.crossVectors(WORLD_Y_CAM, localUp);
          if (_cuEast.lengthSq() < 1e-8) _cuEast.set(1, 0, 0);
          _cuEast.normalize();
          _cuNorth.crossVectors(localUp, _cuEast).normalize();
          // Heading in the tangent plane, then tilted toward local up by pitch.
          // forward = north*cos(yaw) - east*sin(yaw)
          //
          // The signs are not a matter of taste: at the north pole this MUST reduce exactly to the
          // engine's flat basis, (-sin(yaw), 0, -cos(yaw)), or the mouse feels inverted relative to
          // every other map. There, east falls back to +X and north to -Z, so the expression gives
          // -Z at yaw 0 and -X at yaw 90, matching the flat case term for term. My first version had
          // -north*cos(yaw), which is 180 degrees out and mirrored the turn direction, which is what
          // made sliding the mouse move the world the wrong way.
          // scripts/earth/check_lookcontrols.mjs asserts the equivalence numerically.
          _cuFwd.copy(_cuNorth).multiplyScalar(Math.cos(y)).addScaledVector(_cuEast, -Math.sin(y));
          _cuFwd.multiplyScalar(Math.cos(appliedPitch)).addScaledVector(localUp, Math.sin(appliedPitch));
          _cuFwd.normalize();
          _cuRight.crossVectors(_cuFwd, localUp).normalize();
          _cuUp.crossVectors(_cuRight, _cuFwd).normalize();
          _cuMat.makeBasis(_cuRight, _cuUp, _cuFwd.clone().negate());
          camera.quaternion.setFromRotationMatrix(_cuMat);
          camera.up.copy(localUp);
        } else {
          eulerRef.current.set(appliedPitch, yaw.current + recoilYawRef.current, 0);
          camera.quaternion.setFromEuler(eulerRef.current);
        }
        needsCameraUpdate.current = false;
      }

      // Dual-wield: holding the RIGHT button past ~180ms (after its first shot) engages
      // ADS zoom; releasing fires the second shot (handled in mouseUp).
      if (rmbDownAtRef.current && !rmbZoomedRef.current && getRightWeapon() && Date.now() - rmbDownAtRef.current >= 180) {
        rmbZoomedRef.current = true;
        setAiming(true);
      }

      // Phase 3 — ADS FOV zoom. Only touch the FOV during an aim cycle so the
      // resting FOV is never altered. On aim-in, capture the current FOV as the
      // rest value and zoom to the weapon's scopedFov (default rest−25); on
      // release, ease back to that exact rest value, then stop managing FOV.
      {
        const aiming = getAiming();
        isAimingRef.current = aiming;
        const pc = camera as THREE.PerspectiveCamera;
        if (pc.isPerspectiveCamera) {
          const awz = getActiveWeapon();
          const wantZoom = aiming && awz !== null;
          if (wantZoom) {
            if (!adsActiveRef.current) { restFovRef.current = pc.fov; adsActiveRef.current = true; }
            const target = awz?.scopedFov ?? Math.max(40, restFovRef.current - 25);
            const rate = awz?.zoomSpeed ?? 10;
            pc.fov = THREE.MathUtils.damp(pc.fov, target, rate, delta);
            pc.updateProjectionMatrix();
          } else if (adsActiveRef.current) {
            const target = restFovRef.current;
            pc.fov = THREE.MathUtils.damp(pc.fov, target, getActiveWeapon()?.zoomSpeed ?? 10, delta);
            if (Math.abs(pc.fov - target) < 0.05) { pc.fov = target; adsActiveRef.current = false; }
            pc.updateProjectionMatrix();
          } else {
            // Resting (not aiming): apply the user's FoV slider in real time.
            // FirstPersonArms used to drive this each frame but is disabled, so
            // nothing was reading getBaseFov — the slider did nothing. Damp the
            // resting FOV toward the setting so the panel adjusts the view live.
            const base = getBaseFov();
            if (Math.abs(pc.fov - base) > 0.01) {
              pc.fov = THREE.MathUtils.damp(pc.fov, base, 10, delta);
              if (Math.abs(pc.fov - base) < 0.05) pc.fov = base;
              pc.updateProjectionMatrix();
            }
          }
        }
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
      // Conflict rule: a weapon equipped in E1 (a gun, or the flame glove) DISABLES
      // block/tree chopping — empty the equip slot to chop. Prevents left-click
      // doing double-duty as fire AND chop.
      const noWeaponEquipped = getFireWeapon() === null && !isFlameGloveSelectedRef.current;
      if (leftMouseDownRef.current && !showCrosshairsRef.current && !fruitHarvestActive && isOwnedTreeAtPositionRef.current && noWeaponEquipped) {
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
                triggerChop(blockX, blockY, blockZ);

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
                triggerChop(blockX, blockY, blockZ);

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
      
      // Player died (e.g. mid-charge) → HARD-STOP all weapon fire + the looping pentabullet charge
      // whine, which otherwise sticks ON forever (the grating sound on death). Polled every frame so it
      // cuts the instant death is flagged.
      if (isSiegePlayerDead()) {
        if (pentabulletPhaseRef.current !== 'idle') cancelPentabulletCharge();
        autoFiringRef.current = false;
      }

      // Automatic-weapon hold-to-fire: repeat-fire while held (Phase 1). The shot
      // fn self-gates on the weapon's shootCooldown, so calling it every frame
      // produces the correct cadence.
      if (autoFiringRef.current && showCrosshairsRef.current && !isSiegePlayerDead()) {
        fireWeaponShotRef.current?.();
      }

      // Pentabullet charging logic (only in shooting mode with mouse held)
      if (leftMouseDownRef.current && showCrosshairsRef.current && pentabulletChargeStartRef.current && !isSiegePlayerDead()) {
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
      //
      // SIEGE WORLDS PARITY (Geoff, 2026-Aug-22): a character must move at the
      // same speed here as in the Unity game. Source of truth is
      // FirstPersonController.cs — MaxWalkSpeed 2.0, MaxRunSpeed 3.0 — scaled
      // by that character's moveSpeedMultiplier, exactly as Player.cs:410 does
      // (`WalkSpeed = speedScale * MaxWalkSpeed`).
      //
      // This REPLACES DreadRoot's old 4.0 walk / 8.0 sprint, which were about
      // 2x and 2.7x the Siege Worlds values.
      //
      // God mode, the rocket-belt boost and crawl are deliberately left alone:
      // they are DreadRoot-only movement (Siege Worlds has no air-jump, glide
      // or fly) and so have no parity counterpart.
      const charSpeedScale = getSelectedCharacterSpeedScale();
      const baseSpeed = SW_BASE_WALK * charSpeedScale;
      const sprintSpeed = SW_BASE_RUN * charSpeedScale;
      const crawlSpeed = baseSpeed * 0.6;
      // Base god-mode speed, then the optional per-map fly scale (Mini Earth uses altitude;
      // everywhere else flySpeedScale is undefined and this is exactly the old value).
      const godSpeed = (keys.current.shift ? 16.0 : 8.0) * (flySpeedScale ? flySpeedScale() : 1);
      if (userRolesRef.current.includes('admin') || userRolesRef.current.includes('superadmin')) {
        adminEverRef.current = true;
      }
      const wantsBoost = keys.current.shift && keys.current.e;
      const movingForInput = direction.current.lengthSq() > 0.0001; // a movement key is held
      const superSprintSpeed = baseSpeed * 10; // 10x normal speed for the Shift+E forward boost

      // === ROCKET BELT forward-boost (discrete 0.25s bursts; regen 1 / 5s) ===
      // A burst is spent when boosting; max comes from the store (level + tier + VIP, computed
      // in Fortress). Tap = one 0.25s hop; hold = back-to-back bursts until drained.
      const beltTier = getRocketBelt()?.tier ?? 0;
      const beltEquipped = beltTier > 0;
      const beltMax = getRocketBeltMax();
      const beltDt = Math.min(delta, 1 / 30);
      // Cap available to max; grant a full charge the first time a belt qualifies.
      if (beltMax !== beltLastMaxRef.current) {
        if (beltBurstsRef.current === 0 && beltMax > 0) beltBurstsRef.current = beltMax;
        beltBurstsRef.current = Math.min(beltBurstsRef.current, beltMax);
        beltLastMaxRef.current = beltMax;
      }
      // Regenerate 1 burst every BURST_REGEN_SEC while below max.
      if (beltEquipped && beltBurstsRef.current < beltMax) {
        beltRegenAccumRef.current += beltDt;
        while (beltRegenAccumRef.current >= BURST_REGEN_SEC && beltBurstsRef.current < beltMax) {
          beltRegenAccumRef.current -= BURST_REGEN_SEC;
          beltBurstsRef.current += 1;
        }
      } else {
        beltRegenAccumRef.current = 0;
      }
      // Start a new burst when wanting to boost forward, none in progress, and bursts remain.
      if (beltEquipped) {
        if (beltBurstRemainingRef.current <= 0 && wantsBoost && movingForInput && beltBurstsRef.current > 0) {
          beltBurstsRef.current -= 1;
          beltBurstRemainingRef.current = BURST_SEC;
        }
        if (beltBurstRemainingRef.current > 0) beltBurstRemainingRef.current -= beltDt;
      } else {
        beltBurstRemainingRef.current = 0;
      }
      const beltBoostActive = beltEquipped && beltBurstRemainingRef.current > 0;
      // Admin super-sprint stays UNLIMITED only when NO belt is equipped (dev convenience);
      // with a belt on, even admins use the metered belt so it's testable + consistent.
      const adminUnlimited = adminEverRef.current && wantsBoost && !beltEquipped;
      const boostActive = adminUnlimited || beltBoostActive;
      // Publish belt charges to the HUD store (throttled to ~10Hz).
      if (now - beltHudThrottleRef.current > 100) {
        beltHudThrottleRef.current = now;
        setRocketBeltAvailable(beltEquipped ? Math.floor(beltBurstsRef.current) : 0);
      }
      // Shift+E + Q = admin overdrive: 10× ON TOP of the boost (so ~100× base) for crossing the map fast.
      // While overdriving, Q is the SPEED modifier, not fly-up, and movement follows your look heading.
      const qOverdrive = boostActive && keys.current.q;
      const qBoost = qOverdrive ? 10 : 1;
      const runSpeed = godModeRef.current
        ? (boostActive ? godSpeed * 2.5 * qBoost : godSpeed)   // Shift+E super-sprint / rocket boost still speeds you up in God Mode
        : (boostActive ? superSprintSpeed * qBoost : (keys.current.ctrl ? crawlSpeed : (keys.current.shift ? sprintSpeed : baseSpeed)));
      
      // Apply movement
      const forward = forwardVecRef.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      const right = rightVecRef.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      // Planet-centric override (Mini Earth). Replaces the world-axis basis with the local tangent
      // frame so W/S run along the surface and Q/Z go radially out/in, at ANY point on the globe.
      const basis = moveBasis ? moveBasis() : null;
      if (basis) { forward.copy(basis.fwd); right.copy(basis.right); }
      // The vertical axis for Q/Z/space: local up on a planet, world +Y otherwise.
      const upAxis = basis ? basis.up : UP_Y;
      
      const deltaMovement = deltaMovementRef.current.set(0, 0, 0);
      // Use clamped delta for movement to prevent tunneling
      const moveDt = Math.min(delta, 1/30);
      // Siege: wading over a monster corpse halves horizontal speed (corpseSlow returns 1 when there
      // are no corpse zones, so this is a no-op in DreadRoot).
      const wade = corpseSlow(camera.position.x, camera.position.z);
      deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * wade * moveDt);
      deltaMovement.addScaledVector(right, direction.current.x * runSpeed * wade * moveDt);
      
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

      // Spintroll fling spin: whirl the yaw, decaying over ~1.5-2s, then settle.
      if (Math.abs(spinVelRef.current) > 0.01) {
        yaw.current += spinVelRef.current * moveDt;
        needsCameraUpdate.current = true;
        spinVelRef.current *= Math.pow(0.22, moveDt);
        if (Math.abs(spinVelRef.current) < 0.01) spinVelRef.current = 0;
      }

      // Keep the siege god-mode flag in sync EVERY frame (on OR off) so the mesh-collider
      // player bypass + debug overlay read the real state, not a stuck "true".
      if (groundHeightFn) sdbg.godMode = godModeRef.current;
      // God Mode: Q = fly up, Z = fly down, no gravity
      if (godModeRef.current) {
        if (groundHeightFn) { sdbg.isSiege = true; sdbg.playerY = camera.position.y; } // SW debug
        if (qOverdrive) {
          // Boost overdrive: fly in the LOOK direction (level look = level, look down = down, up = up),
          // NOT horizontal + an upward Q. Rebuild the move along the aim; Q no longer adds lift.
          const cp = Math.cos(pitch.current), sp = Math.sin(pitch.current);
          // On a planet, "look" is the tangent forward tilted toward local up by the pitch, not a
          // world-Y tilt (which would aim at the north celestial pole rather than at the sky).
          const look = basis
            ? forwardVecRef.current.copy(basis.fwd).multiplyScalar(cp).addScaledVector(basis.up, sp)
            : forwardVecRef.current.set(-Math.sin(yaw.current) * cp, sp, -Math.cos(yaw.current) * cp);
          deltaMovement.set(0, 0, 0);
          deltaMovement.addScaledVector(look, direction.current.z * runSpeed * moveDt);
          deltaMovement.addScaledVector(right, direction.current.x * runSpeed * moveDt);
          if (keys.current.space) deltaMovement.addScaledVector(upAxis, runSpeed * delta);   // deliberate straight-up only
          if (keys.current.z) deltaMovement.addScaledVector(upAxis, -runSpeed * delta);
        } else {
          // Normal god mode: horizontal move (above) + Q/space fly up, Z fly down.
          if (keys.current.q || keys.current.space) deltaMovement.addScaledVector(upAxis, runSpeed * delta);
          if (keys.current.z) deltaMovement.addScaledVector(upAxis, -runSpeed * delta);
        }
        // No gravity in god mode - just apply direct movement
        velocity.current.set(0, 0, 0);
        camera.position.add(deltaMovement);
        onGround.current = false;

        // SW debug readout — god-mode/FLY path. The full writer below (normal physics) is skipped by
        // this branch's `return`, so without this the debug X/Z + view FREEZE while flying (only Y
        // updated), making every captured coordinate identical. Write the full set from the finalized
        // fly position so copied coords are always live.
        if (groundHeightFn) {
          sdbg.isSiege = true; sdbg.godMode = true; sdbg.onGround = false;
          sdbg.playerX = camera.position.x; sdbg.playerY = camera.position.y; sdbg.playerZ = camera.position.z;
          const _f = camera.getWorldDirection(_sdbgDir);
          sdbg.fwdX = _f.x; sdbg.fwdY = _f.y; sdbg.fwdZ = _f.z;
          sdbg.yawDeg = (Math.atan2(_f.x, _f.z) * 180 / Math.PI + 360) % 360;
          sdbg.pitchDeg = Math.asin(Math.max(-1, Math.min(1, _f.y))) * 180 / Math.PI;
        }

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

      // Physics coyote time: treat "grounded within the last PHYS_COYOTE_MS" as still grounded. The raw
      // onGround flag flickers false for a frame on bumps / downhill / the instant you press to jump —
      // and that flicker was making the FIRST space press fire a JET BOOST instead of a jump (the boost
      // check reads !onGround). With the grace, the first press always jumps, and the boost only fires on
      // a genuine airborne 2nd press. A real jump clears the grace (below) so it can't re-jump mid-air.
      const PHYS_COYOTE_MS = 300;
      if (onGround.current) lastGroundedAtRef.current = now;
      const coyoteGrounded = onGround.current
        || (lastGroundedAtRef.current > 0 && now - lastGroundedAtRef.current < PHYS_COYOTE_MS);

      // Gliding: HOLD G in the air to slow your fall. Held-state (gKeyHeldRef)
      // so it engages reliably even if G was already held before you walked off
      // a ledge — the old one-shot "activate only if already falling" check
      // silently failed in exactly that case. Works during jet boosts too.
      const isGliding = gKeyHeldRef.current && !onGround.current && !isSwimming;
      glideActiveRef.current = isGliding; // mirror for the HUD "G" indicator

      // Determine effective gravity based on state
      let effectiveGravity = 9.8; // Normal gravity
      if (isSwimming) {
        effectiveGravity = 2.45; // 25% gravity in water (Minecraft-style)
      } else if (isGliding) {
        effectiveGravity = 4.9; // 50% gravity when gliding
      }

      // === JET BOOST SYSTEM ===
      // Update max charges based on player level (1 per 3 levels, rounded down)
      const level = playerLevelRef.current || 0;
      const newMaxBoosts = Math.floor(level / 3);
      if (newMaxBoosts !== jetBoostMaxRef.current) {
        dlog('controls', `[JetBoost] Level ${level} → Max boosts changing from ${jetBoostMaxRef.current} to ${newMaxBoosts}`);
        jetBoostMaxRef.current = newMaxBoosts;
        // Cap available to new max
        jetBoostAvailRef.current = Math.min(jetBoostAvailRef.current, newMaxBoosts);
        // Grant initial charges when first qualifying
        if (jetBoostAvailRef.current === 0 && newMaxBoosts > 0) {
          jetBoostAvailRef.current = newMaxBoosts;
        }
        dlog('controls', `[JetBoost] Available: ${jetBoostAvailRef.current}, Max: ${jetBoostMaxRef.current}`);
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
        const isAirborne = !coyoteGrounded;   // genuinely airborne (not a bump / not the jump press)

        if (isAirborne && jetBoostAvailRef.current > 0) {
          jetBoostAvailRef.current -= 1;
          jetBoostRequestRef.current = true;
        }
      }

      // Apply jet boost if requested
      if (jetBoostRequestRef.current) {
        jetBoostRequestRef.current = false;
        boostFlameUntilRef.current = now + 500;   // fire the jet-boot flames for ~0.5 s per boost

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
      // Glide caps your fall speed so you descend slowly and travel far. Without
      // this, a long fall just accelerates past the half-gravity effect and the
      // glide is barely noticeable (the reported "doesn't work" bug). 5 blocks/s
      // ≈ parachute speed; horizontal momentum then carries you a long way.
      // Base 5 blocks/s ≈ parachute speed, scaled by the character's glide factor: 100 = normal,
      // 200 = half speed (glides better), 50 = double (heavier). Voxel = factor 100 → unchanged.
      const GLIDE_FALL_SPEED = 5 * (100 / (siegePlayerPose.glideFactor || 100));
      if (isGliding && velocity.current.y < -GLIDE_FALL_SPEED) {
        velocity.current.y = -GLIDE_FALL_SPEED;
      }
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
            // Already resting on ground — don't push up again (prevents bounce oscillation).
            // BUT only skip for shallow resting jitter: if a block was genuinely placed
            // inside the player (significant up-distance), eject UP even when on the ground,
            // otherwise the player stays embedded and falls through to y=0.
            if (onGround.current && velocity.current.y >= 0 && push.distance < 0.25) {
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
      } else if (parkour.isActive()) {
        // A PARKOUR MOVE IS RUNNING and owns the player outright — position is
        // driven along its path and every normal force is suspended. Gravity in
        // particular would drag the body back down the face it is climbing.
        const step = parkour.advance(performance.now());
        camera.position.set(step.x, step.y + playerHeight, step.z);
        velocity.current.set(0, 0, 0);
        // Pull the camera back here as well: this branch returns before the
        // end-of-loop pull-back, and snapping to first person for the duration
        // of a climb would hide the very move the player zoomed out to watch.
        if (tpCurrent.current > 0) {
          applyThirdPerson(camera, tpCurrent.current, worldCollisionGrid,
            tpEye.current, tpFwd.current, tpRender.current);
          tpEyeSet.current = true;
        }
        if (step.done) {
          onGround.current = step.landsOnGround;
          if (step.landsOnGround) lastGroundedAtRef.current = performance.now();
        }
        return;   // skip all movement + collision this frame
      } else {
        // Normal ground-based jump logic. coyoteGrounded (not the raw flag) so a bump/downhill frame
        // never eats the jump — the press reliably jumps instead of being read as an airborne boost.
        const canJump = coyoteGrounded && !keys.current.ctrl;

        if (keys.current.space && canJump) {
          // JUMPING AT A LEDGE CLIMBS IT. Checked before the jump rather than
          // after, because a jump tuned to feel right in the open will not
          // reliably clear a ledge, and "I jumped and bounced off the wall" is
          // the exact feeling this is meant to remove. Only when actually
          // moving forward, so a stationary hop is still just a hop.
          const wantsForward = keys.current.w && !keys.current.s;
          if (wantsForward) {
            const action = parkour.tryStart(
              camera.position.x, camera.position.y - playerHeight, camera.position.z,
              -Math.sin(yaw.current), -Math.cos(yaw.current),
              !!keys.current.shift,
              performance.now(),
            );
            if (action) { triggerAction(action); velocity.current.y = 0; }
          }
          if (!parkour.isActive()) {
            const jumpHeight = 1.25;   // normal jump for everyone — no admin/superadmin super-jump
            velocity.current.y = Math.sqrt(2 * 9.8 * jumpHeight);
            onGround.current = false;
            lastGroundedAtRef.current = 0;   // consume the grace: no mid-air re-jump; a further press boosts
          }
        }
      }
      // Use moveDt for vertical integration (consistent timestep)
      deltaMovement.y += velocity.current.y * moveDt;

      // X-axis collision - use axis-aware intersection
      if (deltaMovement.x !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.x += deltaMovement.x;
        
        // Substep so a fast move (Rocket Belt boost ~10x / knockback) can't tunnel past a thin
        // wall: a single endpoint test would land PAST a 1-block wall and miss it. Walk in
        // chunks smaller than the player's width so consecutive test boxes overlap (continuous
        // sweep). One iteration at normal speed → no cost.
        {
          const COLLIDE_STEP = 0.4; // < player box width (2*0.3) → no gaps
          const dirX = Math.sign(deltaMovement.x);
          let remX = Math.abs(deltaMovement.x);
          while (remX > 1e-6) {
            const stepX = Math.min(COLLIDE_STEP, remX) * dirX;
            testPosRef.current.copy(camera.position);
            testPosRef.current.x += stepX;
            if (checkAxisCollisionFromCandidates(testPosRef.current, currentColliders, candidateCount, playerRadius, playerHeight, 'x', undefined, onGround.current, velocity.current.y)) {
              velocity.current.x = 0;
              xBlocked = true;
              break;
            }
            camera.position.x = testPosRef.current.x;
            remX -= COLLIDE_STEP;
          }
        }
      }

      // Z-axis collision - use axis-aware intersection
      if (deltaMovement.z !== 0) {
        testPosRef.current.copy(camera.position);
        testPosRef.current.z += deltaMovement.z;
        
        // Substep (see X-axis note) — stop AT the wall instead of tunneling past it on a fast move.
        {
          const COLLIDE_STEP = 0.4;
          const dirZ = Math.sign(deltaMovement.z);
          let remZ = Math.abs(deltaMovement.z);
          while (remZ > 1e-6) {
            const stepZ = Math.min(COLLIDE_STEP, remZ) * dirZ;
            testPosRef.current.copy(camera.position);
            testPosRef.current.z += stepZ;
            if (checkAxisCollisionFromCandidates(testPosRef.current, currentColliders, candidateCount, playerRadius, playerHeight, 'z', undefined, onGround.current, velocity.current.y)) {
              velocity.current.z = 0;
              zBlocked = true;
              break;
            }
            camera.position.z = testPosRef.current.z;
            remZ -= COLLIDE_STEP;
          }
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

        let groundHit = checkAxisCollisionFromCandidates(
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

        // Support = the highest collider under the feet. groundHit now INCLUDES the
        // walapa's own solid, bobbing colliders (no special-casing): you stand on a
        // walapa exactly like a block — its colliders bob, so you bob; when it flies
        // off, its colliders leave and you fall. Natural physics, no per-creature
        // hack. (Also the highest enemy standable-top, for shombie/shroomer.)
        let supportY = groundHit ? groundHit.max.y : -Infinity;
        const enemyTop = EnemyManager.getStandableTopNear(
          camera.position.x, camera.position.z, feetY, 0.6, undefined, playerRadius,
        );
        if (enemyTop != null && enemyTop > supportY) supportY = enemyTop;
        const hasSupport = supportY > -Infinity;

        if ((hasSupport && velocity.current.y <= 0.05) || onWorldGround) {
          if (hasSupport && velocity.current.y < 0) {
            camera.position.y = supportY + playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
          } else if (onWorldGround && !hasSupport && velocity.current.y < 0) {
            camera.position.y = playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
          }
          onGround.current = true;
        } else {
          onGround.current = false;
        }
      }

      // ── Moving-platform ride (general; the walapa is the first user). While your
      //    feet are from a walapa's top to ~1m above it AND you're over its
      //    footprint, your frame of reference rides the platform — you move
      //    HORIZONTALLY with it (vertical is the normal collision above: you stand
      //    on its bobbing collider). Leave the zone (jump >1m, or walk off the edge)
      //    → world frame again, so an accelerating walapa leaves you behind (the
      //    wind blows you off). No velocity is inherited.
      {
        const riderFeetY = camera.position.y - playerHeight;
        let attachW: { id: string; position: THREE.Vector3 } | null = null;
        let attachTop = 0;
        if (walapasRef?.current) {
          for (const w of walapasRef.current) {
            if (!w.isActive) continue;
            const wscale = w.scale ?? 1;
            const wdims = getTierDimensions(w.definition.tier);
            const top = w.position.y + (Math.floor(wdims.height / 2) + 0.5) * wscale + Math.sin(w.bobPhase) * WALAPA_BOB_AMPLITUDE;
            const reach = Math.floor(wdims.width / 2) * wscale + playerRadius;
            const dx = camera.position.x - w.position.x;
            const dz = camera.position.z - w.position.z;
            if (dx * dx + dz * dz > reach * reach) continue;
            if (riderFeetY >= top - 0.3 && riderFeetY <= top + 1.0) { attachW = w; attachTop = top; break; }
          }
        }
        if (attachW) {
          if (currentWalapaIdRef.current === attachW.id) {
            camera.position.x += attachW.position.x - walapaLastPosRef.current.x;
            camera.position.z += attachW.position.z - walapaLastPosRef.current.z;
          }
          // Vertical ride: weld the rider directly onto the walapa's current
          // (bobbing) top whenever they're resting or descending onto it — but
          // NOT while rising from a jump (velocity.y > 0). This tracks the bob +
          // hover exactly, so a rising body can't engulf the player ("head
          // inside") and a moving/bobbing walapa can't drop them through. The old
          // reliance on the one-frame-lagged collision support (above) was the
          // sink / fall-through bug; this weld is authoritative for riding.
          if (velocity.current.y <= 0 && riderFeetY <= attachTop + 0.3) {
            // Weld onto the walapa top, but NEVER below the world ground. A
            // walapa descending onto a grounded player must not drag the rider
            // underground — the weld follows the top down only as far as y=0
            // (the world floor; players never go below the land plane).
            const weldFeet = Math.max(attachTop, 0);
            camera.position.y = weldFeet + playerHeight + SURFACE_EPS;
            velocity.current.y = 0;
            onGround.current = true;
          }
          currentWalapaIdRef.current = attachW.id;
          walapaLastPosRef.current.copy(attachW.position);
        } else {
          currentWalapaIdRef.current = null;
        }
      }

      // ── Siege Worlds terrain floor (final Y authority). Heightfield has no per-block
      //    colliders, so clamp the player onto the sampled ground for smooth walking. Gated:
      //    only runs when groundHeightFn is provided (siege); the voxel world never enters here.
      if (groundHeightFn) {
        let tY = groundHeightFn(camera.position.x, camera.position.z);
        // ── Slope limit (siege terrain): you can't walk UP anything steeper than ~60°, and you
        //    slide DOWN steep ground. Walking along/down passes through normally. God-mode ignores it.
        if (tY != null && onGround.current && !godModeRef.current) {
          const TAN60 = 1.7320508, SLIDE_SPEED = 9, e = 1;
          const last = lastSiegeGround.current;
          // Block a too-steep CLIMB: if this frame's move gained height faster than tan(60°) per
          // metre travelled, undo the horizontal move — you stop at the base of the cliff.
          if (last) {
            const dxz = Math.hypot(camera.position.x - last.x, camera.position.z - last.z);
            if (dxz > 0.01 && (tY - last.y) / dxz > TAN60) {
              camera.position.x = last.x; camera.position.z = last.z; tY = last.y;
            }
          }
          // Slide DOWN steep slopes: drift opposite the uphill gradient.
          const gxp = groundHeightFn(camera.position.x + e, camera.position.z);
          const gxm = groundHeightFn(camera.position.x - e, camera.position.z);
          const gzp = groundHeightFn(camera.position.x, camera.position.z + e);
          const gzm = groundHeightFn(camera.position.x, camera.position.z - e);
          if (gxp != null && gxm != null && gzp != null && gzm != null) {
            const gx = (gxp - gxm) / (2 * e), gz = (gzp - gzm) / (2 * e); // points uphill
            const slope = Math.hypot(gx, gz);
            if (slope > TAN60) {
              const k = (SLIDE_SPEED * dt) / slope;
              camera.position.x -= gx * k; camera.position.z -= gz * k;
              // Glue to the slope surface as we drift down — otherwise the player rides horizontally
              // over descending ground while grounded gravity is suppressed, and floats in mid-air.
              const nY = groundHeightFn(camera.position.x, camera.position.z);
              if (nY != null) { tY = nY; camera.position.y = nY + playerHeight + SURFACE_EPS; velocity.current.y = 0; }
            }
          }
        }
        sdbg.isSiege = true; sdbg.ghf = true; sdbg.godMode = godModeRef.current; sdbg.onGround = onGround.current; sdbg.playerY = camera.position.y; sdbg.terrainY = tY; // SW debug
        sdbg.playerX = camera.position.x; sdbg.playerZ = camera.position.z;
        { const _f = camera.getWorldDirection(_sdbgDir); sdbg.fwdX = _f.x; sdbg.fwdY = _f.y; sdbg.fwdZ = _f.z;
          sdbg.yawDeg = (Math.atan2(_f.x, _f.z) * 180 / Math.PI + 360) % 360; sdbg.pitchDeg = Math.asin(Math.max(-1, Math.min(1, _f.y))) * 180 / Math.PI; }
        // Floor = terrain height, or sea level (22) as a fallback if the heightfield is
        // missing here. Snap + set grounded ONLY when at/below the floor; when ABOVE it, do
        // NOT touch onGround so gravity keeps pulling the player down. (The old code forced
        // onGround=true even mid-air, which killed gravity and left the player hovering.)
        const floorY = (tY != null ? tY : 22) + playerHeight + SURFACE_EPS;
        if (camera.position.y <= floorY) {
          camera.position.y = floorY;
          if (velocity.current.y < 0) velocity.current.y = 0;
          onGround.current = true;
        }
        lastSiegeGround.current = { x: camera.position.x, z: camera.position.z, y: tY != null ? tY : 22 };
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

      // Publish the true player eye + facing (BEFORE the pull-back) for the
      // self-avatar + HUD. NO LONGER siege-only: DreadRoot now renders a player
      // body too and needs the identical numbers. These are plain writes to a
      // module object, so publishing them in both games costs nothing and
      // changes nothing for Siege Worlds.
      {
        siegePlayerPose.x = camera.position.x; siegePlayerPose.y = camera.position.y; siegePlayerPose.z = camera.position.z;
        siegePlayerPose.fx = -Math.sin(yaw.current); siegePlayerPose.fz = -Math.cos(yaw.current);
        // Movement state → drives the self-avatar's locomotion animation.
        siegePlayerPose.mf = (keys.current.w ? 1 : 0) - (keys.current.s ? 1 : 0);
        siegePlayerPose.mr = (keys.current.d ? 1 : 0) - (keys.current.a ? 1 : 0);
        siegePlayerPose.run = !!keys.current.shift;
        siegePlayerPose.grounded = onGround.current;
        siegePlayerPose.vy = velocity.current.y;
        siegePlayerPose.gun = showCrosshairsRef.current;
        siegePlayerPose.gliding = glideActiveRef.current;
        siegePlayerPose.boosting = performance.now() < boostFlameUntilRef.current;
      }

      // Third-person RENDER pull-back (BOTH games now, when zoomed out): everything above used the true eye
      // (movement, collision, aim, multiplayer broadcast, chunk-load); now move ONLY the rendered
      // camera back along the look direction. Saved eye is restored at the top of next frame. When
      // first-person (distance 0) this whole block is skipped → identical to today.
      if (tpCurrent.current > 0) {
        applyThirdPerson(camera, tpCurrent.current, worldCollisionGrid,
          tpEye.current, tpFwd.current, tpRender.current);
        tpEyeSet.current = true;
      } else {
        tpEyeSet.current = false;
      }
    }, 20); // High priority - controls run early

    return unregister;
  }, [camera, raycastMeshes, setHoveredBlockId]);

  return null;
}
