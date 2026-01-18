import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import type { ShwarmDefinition } from '@/features/shwarm/types';
// ============================================================
// DEBUG CONFIGURATION
// ============================================================
// Set to true to enable detailed debugging logs for movement, collisions, mouse tracking, etc.
// WARNING: Enabling this will SEVERELY impact FPS (6-9 FPS) due to high-frequency console spam.
export const DEBUG_LOGGING = false;

// Weather settings interface
export interface WeatherSettings {
  lightingRange: [number, number];
  cycleDuration: number;
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
}

// Cycle state for weather/sky/lighting
export interface CycleState {
  lightingPercentage: number;
  cyclePosition: number;
  isNight: boolean;
}

// Scene props interface
export interface SceneProps {
  settings: GameSettings;
  onCoinHit: (position: THREE.Vector3) => void;
  coinImageUrl?: string;
  wallPositions: Record<number, { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>;
  blockPlacementMode: boolean;
  treePlacementMode: boolean;
  onBlockPlace: (position: THREE.Vector3) => void;
  onTreePlace: (position: THREE.Vector3) => void;
  onModeChange: (mode: 'shooting' | 'building' | 'planting' | null) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'inventory' | 'store') => void;
  crosshairsEnabled: boolean;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  selectedSeedTier: number | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  onCycleSeed: (direction: 'next' | 'prev') => void;
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
  // World texture URLs
  fortressTextureUrl?: string | null;
  groundTextureUrl?: string | null;
  skyTextureUrl?: string | null;
  // Seed definitions for tree planting
  seedDefinitions?: Array<{ id: string; tier: number; trunk_texture_url: string | null }>;
  // Knockback function for shwarm damage
  applyKnockback?: (direction: THREE.Vector3, distance: number) => void;
  // Player health ref for combat
  healthRef?: React.MutableRefObject<{ currentHealth: number; maxHealth: number; isDead: boolean }>;
  // Take damage callback
  takeDamage?: (amount: number, knockbackDir?: THREE.Vector3, knockbackDistance?: number) => { died: boolean };
  // Shwarm system
  shwarmDefinitions?: ShwarmDefinition[];
  onShwarmDamage?: (shwarmId: string, blockId: string, damage: number) => boolean;
}

// First person controls props
export interface FirstPersonControlsProps {
  onShoot?: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  showCrosshairs: boolean;
  audioRefs: Omit<AudioRefs, 'woodenThud' | 'wispBoom' | 'wispCheer'>;
  playAudio: (audio: HTMLAudioElement) => Promise<void>;
  blockPlacementMode: boolean;
  treePlacementMode: boolean;
  onBlockPlace?: (position: THREE.Vector3) => void;
  onTreePlace?: (position: THREE.Vector3) => void;
  onOpenPanel: (tab: 'user' | 'wallet' | 'inventory' | 'store') => void;
  onModeChange: (mode: 'shooting' | 'building' | 'planting' | null) => void;
  getBlockQuantity: (itemType: string) => number;
  selectedBlockType: string | null;
  selectedSeedTier: number | null;
  panelOpen: boolean;
  onCycleBlock: (direction: 'next' | 'prev') => void;
  onCycleSeed: (direction: 'next' | 'prev') => void;
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
  // Knockback function for shwarm damage
  applyKnockback?: (direction: THREE.Vector3, distance: number) => void;
}

// Bullet interface
export interface Bullet {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  life: number;
}

// Flying coin interface
export interface FlyingCoin {
  id: string;
  startX: number;
  startY: number;
  startTime: number;
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
}
