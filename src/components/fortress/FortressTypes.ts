import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import type { ShwarmDefinition } from '@/features/shwarm/types';
import type { ShnakeDefinition } from '@/features/shnake/types';
import type { ShombieDefinition } from '@/features/shombie/types';
import type { WalapaDefinition, WalapaInstance } from '@/features/walapa/types';
import type { ShtickmanDefinition } from '@/features/shtickman/types';
// ============================================================
// DEBUG CONFIGURATION
// ============================================================
// Set to true to enable detailed debugging logs for movement, collisions, mouse tracking, etc.
// WARNING: Enabling this will SEVERELY impact FPS (6-9 FPS) due to high-frequency console spam.
export const DEBUG_LOGGING = false;

// Cloud layer settings for procedural sky clouds
export interface CloudLayerSettings {
  enabled: boolean;
  opacity: number;      // 0-1
  coverage: number;     // 0-1 (0 = clear sky, 1 = fully overcast)
  height: number;       // world units above origin
  speed: number;        // wind speed (world units/sec)
  direction: number;    // wind direction in degrees (0 = north/+Z, 90 = east/+X)
  scale: number;        // noise pattern scale
  color: string;        // hex color
}

// Distant chunk ring settings (per-ring)
export interface DistantChunkRingSettings {
  opacity: number;     // 0-1, base opacity before fog is applied
}

// View settings for distant chunk rendering (saved globally per-world)
export interface ViewSettings {
  baseColor: string;              // hex color for silhouette base
  ring1: DistantChunkRingSettings;
  ring2: DistantChunkRingSettings;
  ring3: DistantChunkRingSettings;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  baseColor: '#4d5261',
  ring1: { opacity: 0.55 },
  ring2: { opacity: 0.40 },
  ring3: { opacity: 0.30 },
};

// Weather settings interface
export interface WeatherSettings {
  lightingRange: [number, number];
  cycleDuration: number;
  cloudLayer1?: CloudLayerSettings;
  cloudLayer2?: CloudLayerSettings;
}

// Lightning Panel settings (real-time debug/tuning)
export interface LightningSettings {
  fogStartPct: number;       // 0-100, percentage of render distance where fog begins
  fogEndPct: number;         // 0-100, percentage of render distance where fog is fully opaque
  fogDayColor: string;       // Hex color string e.g. "#cccccc"
  fogNightColor: string;     // Hex color string e.g. "#222233"
  fogEnabled: boolean;
  visualDistance: number;     // 1-20 chunks
  lightingOverride: number | null; // null = auto cycle, 0-100 = manual lighting percentage
  freezeCycle: boolean;       // If true, day/night cycle pauses
  settingsVersion?: number;   // Migration version for localStorage defaults
}

// Game settings interface
export interface GameSettings {
  flowSpeed: number;
  msBetweeenDrops: number;
  coinRate: number;
  coinSize: number;
  colorPalette: Array<{ hex: string; weight: number }>;
}

// Audio refs interface
export interface AudioRefs {
  pistolCocking: HTMLAudioElement;
  pistolHolster: HTMLAudioElement;
  gunshot: HTMLAudioElement;
  coinHit: HTMLAudioElement;
  woodenThud: HTMLAudioElement;
  wispBoom: HTMLAudioElement;
  wispCheer: HTMLAudioElement;
  // Shwarm combat sounds
  shwarmHit: HTMLAudioElement;
  playerHit: HTMLAudioElement;
  // Pentabullet sounds
  pentabulletFire: HTMLAudioElement;
  pentabulletPowerup: HTMLAudioElement;
  pentabulletSteady: HTMLAudioElement;
  pentabulletPowerdown: HTMLAudioElement;
}

// Cycle state for weather/sky/lighting
export interface CycleState {
  lightingPercentage: number;
  cyclePosition: number;
  isNight: boolean;
}

// Selected hotbar item definition (passed from Fortress → Scene → Controls)
export interface SelectedItemDef {
  itemNumber: number | null;
  tier: number | null;
  name: string | null;
  itemId: string | null;
}

// Scene props interface
export interface SceneProps {
  settings: GameSettings;
  onCoinHit: (position: THREE.Vector3) => void;
  coinImageUrl?: string;
  wallPositions: Record<number, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>;
  blockPlacementMode: boolean;
  treePlacementMode: boolean;
  fungalPlacementMode: boolean;
  widePlacementMode: boolean;
  onBlockPlace: (position: THREE.Vector3) => void;
  onTreePlace: (position: THREE.Vector3) => void;
  onFungalTreePlace: (position: THREE.Vector3) => void;
  onWideTreePlace: (position: THREE.Vector3) => void;
  onModeChange: (mode: 'shooting' | 'building' | 'planting' | 'fungal_planting' | 'wide_planting' | null) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'kills' | 'blocks' | 'market') => void;
  crosshairsEnabled: boolean;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  selectedSeedTier: number | null;
  selectedFungalTier: number | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  onCycleSeed: (direction: 'next' | 'prev') => void;
  onCycleFungalSeed: (direction: 'next' | 'prev') => void;
  onCycleWideSeed: (direction: 'next' | 'prev') => void;
  selectedWideTier: number | null;
  blocks: PlacedBlock[];
  weatherSettings: WeatherSettings;
  onBlockRain: () => void;
  userRoles: string[];
  isMoveMode: boolean;
  onBlockRemove?: (blockId: string) => Promise<void>;
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId: string | null;
  setHoveredBlockId: (id: string | null) => void;
  collectWispBlock: (blockKey: string) => Promise<boolean>;
  toast: any;
  waterfallEnabled?: boolean;
  onGodModeChange?: (enabled: boolean) => void;
  performanceMode?: boolean;
  // Bullet tier selection (admin only)
  selectedBulletTier?: number;
  onBulletTierChange?: (tier: number) => void;
  // World texture URLs
  fortressTextureUrl?: string | null;
  groundTextureUrl?: string | null;
  skyTextureUrl?: string | null;
  // Seed definitions for tree planting
  seedDefinitions?: Array<{ id: string; tier: number; trunk_texture_url: string | null; fruit_texture_url?: string | null }>;
  // Player health ref for combat
  healthRef?: React.MutableRefObject<{ currentHealth: number; maxHealth: number; isDead: boolean }>;
  // Universal damage function (processes through damage pipeline with STEADY, armor, etc.)
  applyDamageWithKnockback?: (
    damage: number,
    knockbackDir: THREE.Vector3,
    knockbackForce: number,
    source: { type: 'enemy' | 'environment' | 'player'; entityId?: string; entityName?: string },
    damageType?: string
  ) => { blocked: boolean; died?: boolean; finalDamage?: number };
  // Legacy take damage callback (deprecated - use applyDamageWithKnockback)
  takeDamage?: (amount: number, knockbackDir?: THREE.Vector3, knockbackDistance?: number) => { died: boolean };
  // Shwarm system
  shwarmDefinitions?: ShwarmDefinition[];
  onShwarmDamage?: (shwarmId: string, blockId: string, damage: number) => boolean;
  // Shnake system
  shnakeDefinitions?: ShnakeDefinition[];
  plantedTrees?: import('@/features/trees/types').PlantedTree[];
  treeFruits?: import('@/features/trees/types').TreeFruit[];
  onFruitRemoved?: (fruitId: string) => void;
  // Shombie system
  shombieDefinitions?: ShombieDefinition[];
  // Walapa system
  walapaDefinitions?: WalapaDefinition[];
  onWalapaKilled?: (tier: number) => void;
  /** Fired when a shpider dies. Used by Fortress.tsx to bump
   *  user_combat_stats so the Kills panel shows them. */
  onShpiderKilled?: (tier: number) => void;
  // Shtickman system
  shtickmanDefinitions?: ShtickmanDefinition[];
  onShtickmanKilled?: (tier: number) => void;
  // Points system callback
  onPointsEarned?: (points: number) => void;
  // Shwarm group killed callback (passes tier for kill tracking)
  onShwarmGroupKilled?: (tier: number) => void;
  // Shnake killed callback (passes tier for kill tracking)
  onShnakeKilled?: (tier: number) => void;
  // Shombie killed callback (passes tier for kill tracking)
  onShombieKilled?: (tier: number) => void;
  // Respawn position for teleporting player
  respawnPosition?: THREE.Vector3 | null;
  onRespawnComplete?: () => void;
  // Tree chopping props
  isOwnedTreeAtPosition?: (x: number, y: number, z: number) => boolean;
  onTreeChopComplete?: (x: number, y: number, z: number) => Promise<void>;
  onTreeChopProgress?: (chopCount: number, maxChops: number) => void;
  // Block mining props (admin only)
  onBlockMineComplete?: (x: number, y: number, z: number) => Promise<void>;
  // Pentabullet system
  playerLevel?: number;
  onPentabulletChargeChange?: (charge: number) => void;
  /** Activate a hotbar slot by index (1-6). Used for keyboard digits
   *  consuming health potions, etc. */
  onUseHotbarSlot?: (slot: number) => void;
  /** Throw a grenade now. Returns true if one was actually thrown
   *  (false if inventory empty / live cap hit). */
  onThrowGrenade?: () => boolean;
  /** Parent-supplied G-key handler. Parent decides whether to arm
   *  (and which slot) based on inventory + equipped state. */
  onGrenadeTogglePress?: () => void;
  /** True while a grenade is pin-pulled. Read by the click handler. */
  grenadeReady?: boolean;
  /** Which hotbar slot is currently grenade-armed (1-6 or null).
   *  HUD flashes only this specific slot. */
  grenadeReadySlot?: number | null;
  /** H key handler — drink a potion (auto-equip if needed). */
  onHealthPotionUse?: () => void;
  /** Slot index (1-6) currently flashing red while a potion drink
   *  animation plays. Null when nothing is drinking. */
  potionDrinkingSlot?: number | null;
  /** Take one grenade out of the user's inventory and return its
   *  tier. Returns null if no grenade is held. Inventory is owned by
   *  Fortress.tsx so the throw mechanism delegates here. */
  consumeGrenade?: () => number | null;
  /** Admin/superadmin only: grant 1 grenade and auto-equip to hotbar
   *  slot 6 if free. Wired to Cmd+G in FortressControls. */
  onAdminGrantGrenade?: () => Promise<boolean>;
  /** Admin/superadmin only: grant 1 health potion (same equip rule). */
  onAdminGrantHealthPotion?: () => Promise<boolean>;
  /** Vault: parent state, scene reports proximity, V opens. */
  vaultInRange?: boolean;
  onVaultProximityChange?: (inRange: boolean) => void;
  onOpenVault?: () => void;
  // Jet Boost system
  onJetBoostStateChange?: (state: JetBoostState) => void;
  // Selected hotbar item (for flame glove detection)
  selectedItemDef?: SelectedItemDef;
  // Inventory management
  addItem?: (itemId: string, quantity: number) => Promise<boolean>;
  // Lightning Panel overrides
  lightningSettings?: LightningSettings;
  // View settings for distant chunk rendering
  viewSettings?: ViewSettings;
}

// First person controls props
export interface FirstPersonControlsProps {
  onShoot?: (origin: THREE.Vector3, direction: THREE.Vector3, isPentabullet?: boolean) => void;
  showCrosshairs: boolean;
  audioRefs: Omit<AudioRefs, 'woodenThud' | 'wispBoom' | 'wispCheer'>;
  playAudio: (audio: HTMLAudioElement) => Promise<void>;
  blockPlacementMode: boolean;
  treePlacementMode: boolean;
  fungalPlacementMode: boolean;
  widePlacementMode: boolean;
  onBlockPlace?: (position: THREE.Vector3) => void;
  onTreePlace?: (position: THREE.Vector3) => void;
  onFungalTreePlace?: (position: THREE.Vector3) => void;
  onWideTreePlace?: (position: THREE.Vector3) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'kills' | 'blocks' | 'market') => void;
  onToggleInventory?: () => void;
  onModeChange: (mode: 'shooting' | 'building' | 'planting' | 'fungal_planting' | 'wide_planting' | null) => void;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  selectedSeedTier: number | null;
  selectedFungalTier: number | null;
  selectedWideTier: number | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  onCycleSeed: (direction: 'next' | 'prev') => void;
  onCycleFungalSeed: (direction: 'next' | 'prev') => void;
  onCycleWideSeed: (direction: 'next' | 'prev') => void;
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
  // Phase 2B: Chunk loading callback
  updatePlayerPosition?: (worldX: number, worldZ: number) => void;
  // Respawn position - when set, teleport player to this position
  respawnPosition?: THREE.Vector3 | null;
  onRespawnComplete?: () => void;
  // Tree chopping props
  isOwnedTreeAtPosition?: (x: number, y: number, z: number) => boolean;
  onTreeChopComplete?: (x: number, y: number, z: number) => Promise<void>;
  onTreeChopProgress?: (chopCount: number, maxChops: number) => void;
  // Block mining props (admin only)
  onBlockMineComplete?: (x: number, y: number, z: number) => Promise<void>;
  // Bullet tier selection (admin only)
  onBulletTierChange?: (tier: number) => void;
  // Pentabullet system
  playerLevel?: number;
  onPentabulletChargeChange?: (charge: number) => void;
  /** Activate a hotbar slot by index (1-6). Used for keyboard digits
   *  consuming health potions, etc. */
  onUseHotbarSlot?: (slot: number) => void;
  /** Throw a grenade now. Returns true if one was actually thrown
   *  (false if inventory empty / live cap hit). */
  onThrowGrenade?: () => boolean;
  /** Parent G-press handler. */
  onGrenadeTogglePress?: () => void;
  /** True while grenade is armed. */
  grenadeReady?: boolean;
  /** H-press handler. */
  onHealthPotionUse?: () => void;
  /** Admin/superadmin only: Cmd+G grants a grenade. */
  onAdminGrantGrenade?: () => Promise<boolean>;
  /** Admin/superadmin only: Cmd+H grants a health potion. */
  onAdminGrantHealthPotion?: () => Promise<boolean>;
  /** V key handler — Fortress.tsx only wires this when player is in
   *  the vault's back-wall trigger zone. */
  onOpenVault?: () => void;
  // Admin spawn shortcut (!2# for shnakes)
  onSpawnShnake?: (tier: number) => void;
  // Jet Boost system
  onJetBoostStateChange?: (state: { available: number; max: number; nextRefillAtMs: number; isGliding: boolean }) => void;
  onJetBoostFired?: (position: THREE.Vector3, colors: string[]) => void;
  bulletTier?: number;
  // Walapa riding system - ref to active walapas for moving platform support
  walapasRef?: React.MutableRefObject<WalapaInstance[]>;
  // Flame Glove system
  isFlameGloveSelected?: boolean;
  onFlameStart?: () => void;
  onFlameStop?: () => void;
  // Fruit harvest system (F-key)
  onHarvestFruit?: () => void;
  // Swimming system - water detection callback
  checkIsInWater?: (x: number, y: number, z: number) => boolean;
  getWaterType?: (x: number, y: number, z: number) => 'water' | 'lava' | null;
  // Swimming state callbacks
  onSwimmingStateChange?: (isSwimming: boolean, waterType: 'water' | 'lava' | null) => void;
  // Lava damage callback
  onLavaDamage?: (damage: number) => void;
  // Block Inspector: access to loaded chunks for comprehensive inspection
  loadedChunksRef?: React.MutableRefObject<Map<string, { blocks: PlacedBlock[]; visibleBlocks?: PlacedBlock[] }>>;
  currentWorldId?: string | null;
}

// Jet Boost state for HUD
export interface JetBoostState {
  available: number;
  max: number;
  nextRefillAtMs: number;
  isGliding: boolean;
}

// Bullet interface
export interface Bullet {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  velocityY: number;  // Separate Y velocity for gravity arc
  speed: number;
  life: number;
  tier: number;       // Bullet tier for impact scaling
  color: string;      // Hex color for impact effect
  ricochetScale: number; // Starts at 1.0, multiplied by 0.75 each ricochet
  isPentabullet: boolean; // Pentabullet shots have 3x larger/longer impacts
}

// Flying coin interface
export interface FlyingCoin {
  id: string;
  startX: number;
  startY: number;
  startTime: number;
  imageUrl?: string; // URL of the coin image to display
}

// Waterfall drop interface
export interface WaterfallDrop {
  position: THREE.Vector3;
  velocity: number;
  stretchFactor: number;
  color: THREE.Color;
  active: boolean;
}

// Coin interface
export interface Coin {
  position: THREE.Vector3;
  velocity: number;
  rotation: number;
  rotSpeed: number;
  scaleJitter: number;
  visible: boolean;
  mesh: THREE.Sprite | null;
}

// Explosion particle interface
export interface ExplosionParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  velocityY: number;
  rotation: number;
  rotSpeed: number;
  opacity: number;
  scale: number;
  active: boolean;
  mesh: THREE.Sprite | null;
}

// Wisp particle interface
export interface WispParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  color: string;
  scale?: number; // Optional scale for explosion particles (default 1.0)
}
