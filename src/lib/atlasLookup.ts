/**
 * Atlas Lookup Functions
 *
 * Provides UV coordinate lookups for different texture categories.
 * All functions return normalized UV coordinates (0-1 range).
 */

import { ATLAS_GRID_SIZE } from './textureAtlas';
import { atlasManager, getSlotPixelPosition } from './atlasManager';

export interface AtlasUVs {
  uvOffsetX: number;
  uvOffsetY: number;
  uvScaleX: number;
  uvScaleY: number;
}

export interface AnimatedAtlasUVs extends AtlasUVs {
  frameCount: number;
  frameDelayMs: number;
  baseSlotIndex: number;
}

const SLOT_UV_SIZE = 1 / ATLAS_GRID_SIZE;

/**
 * Convert slot index to UV coordinates
 */
export function slotIndexToUVs(slotIndex: number): AtlasUVs {
  const col = slotIndex % ATLAS_GRID_SIZE;
  const row = Math.floor(slotIndex / ATLAS_GRID_SIZE);

  return {
    uvOffsetX: col * SLOT_UV_SIZE,
    uvOffsetY: 1 - (row + 1) * SLOT_UV_SIZE, // Flip Y for WebGL
    uvScaleX: SLOT_UV_SIZE,
    uvScaleY: SLOT_UV_SIZE,
  };
}

/**
 * Get UV offset for a specific animation frame
 */
export function getAnimationFrameUVs(baseSlotIndex: number, frameIndex: number): AtlasUVs {
  return slotIndexToUVs(baseSlotIndex + frameIndex);
}

// ============================================
// TEXTURE ID GENERATORS
// ============================================

export function getTreeTextureId(tier: number, type: 'trunk' | 'branch' | 'fruit'): string {
  return `tree_t${tier}_${type}`;
}

export function getShwarmTextureId(tier: number): string {
  return `shwarm_t${tier}`;
}

export function getShombieTextureId(tier: number): string {
  return `shombie_t${tier}`;
}

export function getShnakeTextureId(tier: number, part: 'head' | 'body' | 'face'): string {
  return `shnake_t${tier}_${part}`;
}

export function getWalapaTextureId(tier: number, part: 'body' | 'belly' | 'eyes'): string {
  return `walapa_t${tier}_${part}`;
}

export function getFungalTreeTextureId(tier: number, type: 'stem' | 'cap_top' | 'cap_underside'): string {
  return `fungal_t${tier}_${type}`;
}

export function getBlockTextureId(blockType: string): string {
  return `block_${blockType}`;
}

export function getGlobalTextureId(name: string): string {
  return `global_${name}`;
}

// ============================================
// UV LOOKUP FUNCTIONS
// ============================================

/**
 * Calculate the deterministic slot index for a tree texture.
 * Tree textures are allocated sequentially: tier N uses slots (N-1)*3 to (N-1)*3+2
 * Slot order within tier: trunk, branch, fruit
 */
function calculateTreeSlotIndex(tier: number, type: 'trunk' | 'branch' | 'fruit'): number {
  const typeOffset = type === 'trunk' ? 0 : type === 'branch' ? 1 : 2;
  return (tier - 1) * 3 + typeOffset;
}

/**
 * Get UVs for a tree texture
 */
// Diagnostic: track which tree UV lookups have been logged (once per unique textureId)
const _treeUvDiagLogged = new Set<string>();

export function getTreeUVs(tier: number, type: 'trunk' | 'branch' | 'fruit'): AtlasUVs | null {
  const textureId = getTreeTextureId(tier, type);
  const slot = atlasManager.getSlotForTexture(textureId);

  if (slot) {
    if (!_treeUvDiagLogged.has(textureId)) {
      _treeUvDiagLogged.add(textureId);
      const det = calculateTreeSlotIndex(tier, type);
      if (det !== slot.slotIndex) {
        console.warn(`[AtlasUV] SLOT MISMATCH: ${textureId} atlas=${slot.slotIndex} deterministic=${det}`);
      }
    }
    return slotIndexToUVs(slot.slotIndex);
  }

  // Fallback: use deterministic slot calculation if metadata lookup fails
  // This handles race conditions where blocks render before sync completes
  const calculatedSlot = calculateTreeSlotIndex(tier, type);
  if (!_treeUvDiagLogged.has(textureId)) {
    _treeUvDiagLogged.add(textureId);
    console.warn(`[AtlasUV] FALLBACK: ${textureId} → deterministic slot ${calculatedSlot} (no atlas entry)`);
  }
  return slotIndexToUVs(calculatedSlot);
}

/**
 * Calculate the deterministic slot index for a fungal tree texture.
 * Fungal textures start at slot 840: tier N uses slots 840 + (N-1)*3 to 840 + (N-1)*3+2
 * Slot order within tier: stem, cap_top, cap_underside
 */
export function calculateFungalTreeSlotIndex(tier: number, type: 'stem' | 'cap_top' | 'cap_underside'): number {
  const typeOffset = type === 'stem' ? 0 : type === 'cap_top' ? 1 : 2;
  return 840 + (tier - 1) * 3 + typeOffset;
}

/**
 * Get UVs for a fungal tree texture
 */
export function getFungalTreeUVs(tier: number, type: 'stem' | 'cap_top' | 'cap_underside'): AtlasUVs | null {
  const textureId = getFungalTreeTextureId(tier, type);
  const slot = atlasManager.getSlotForTexture(textureId);

  if (slot) {
    if (!_treeUvDiagLogged.has(textureId)) {
      _treeUvDiagLogged.add(textureId);
      const det = calculateFungalTreeSlotIndex(tier, type);
      if (det !== slot.slotIndex) {
        console.warn(`[AtlasUV] FUNGAL SLOT MISMATCH: ${textureId} atlas=${slot.slotIndex} deterministic=${det}`);
      }
    }
    return slotIndexToUVs(slot.slotIndex);
  }

  // Fallback: use deterministic slot calculation
  const calculatedSlot = calculateFungalTreeSlotIndex(tier, type);
  if (!_treeUvDiagLogged.has(textureId)) {
    _treeUvDiagLogged.add(textureId);
    console.warn(`[AtlasUV] FUNGAL FALLBACK: ${textureId} → deterministic slot ${calculatedSlot}`);
  }
  return slotIndexToUVs(calculatedSlot);
}

/**
 * Get UVs for a tree texture with animation info
 */
export function getTreeUVsWithAnimation(tier: number, type: 'trunk' | 'branch' | 'fruit'): AnimatedAtlasUVs | null {
  const textureId = getTreeTextureId(tier, type);
  const slot = atlasManager.getSlotForTexture(textureId);

  if (slot) {
    const baseUVs = slotIndexToUVs(slot.slotIndex);
    return {
      ...baseUVs,
      frameCount: slot.metadata.frameCount || 1,
      frameDelayMs: slot.metadata.frameDelayMs || 100,
      baseSlotIndex: slot.slotIndex,
    };
  }

  // Fallback: use deterministic slot calculation (static, no animation)
  const calculatedSlot = calculateTreeSlotIndex(tier, type);
  const baseUVs = slotIndexToUVs(calculatedSlot);
  return {
    ...baseUVs,
    frameCount: 1,
    frameDelayMs: 100,
    baseSlotIndex: calculatedSlot,
  };
}

/**
 * Get UVs for a shwarm face texture by face index (0-4).
 * Face textures are stored in T1-T5 shwarm slots.
 * Each shwarm block picks a face via blockIndex % 5.
 */
export function getShwarmFaceUVs(faceIndex: number): AnimatedAtlasUVs | null {
  // Face textures are stored as shwarm_t1 through shwarm_t5
  const tier = (faceIndex % 5) + 1;
  return getShwarmUVs(tier);
}

/**
 * Get UVs for a shwarm texture (with animation support)
 */
export function getShwarmUVs(tier: number): AnimatedAtlasUVs | null {
  const textureId = getShwarmTextureId(tier);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;

  const baseUVs = slotIndexToUVs(slot.slotIndex);

  return {
    ...baseUVs,
    frameCount: slot.metadata.frameCount || 1,
    frameDelayMs: slot.metadata.frameDelayMs || 100,
    baseSlotIndex: slot.slotIndex,
  };
}

/**
 * Get UVs for a shombie texture (with animation support)
 */
export function getShombieUVs(tier: number): AnimatedAtlasUVs | null {
  const textureId = getShombieTextureId(tier);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;

  const baseUVs = slotIndexToUVs(slot.slotIndex);

  return {
    ...baseUVs,
    frameCount: slot.metadata.frameCount || 1,
    frameDelayMs: slot.metadata.frameDelayMs || 100,
    baseSlotIndex: slot.slotIndex,
  };
}

/**
 * Get UVs for a shnake texture part
 */
export function getShnakeUVs(tier: number, part: 'head' | 'body' | 'face'): AnimatedAtlasUVs | null {
  const textureId = getShnakeTextureId(tier, part);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;

  const baseUVs = slotIndexToUVs(slot.slotIndex);

  return {
    ...baseUVs,
    frameCount: slot.metadata.frameCount || 1,
    frameDelayMs: slot.metadata.frameDelayMs || 100,
    baseSlotIndex: slot.slotIndex,
  };
}

/**
 * Get UVs for a walapa texture part
 */
export function getWalapaUVs(tier: number, part: 'body' | 'belly' | 'eyes'): AtlasUVs | null {
  const textureId = getWalapaTextureId(tier, part);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;
  return slotIndexToUVs(slot.slotIndex);
}

/**
 * Get UVs for a block texture
 */
export function getBlockUVs(blockType: string): AtlasUVs | null {
  const textureId = getBlockTextureId(blockType);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;
  return slotIndexToUVs(slot.slotIndex);
}

/**
 * Get UVs for a global texture
 */
export function getGlobalUVs(name: string): AtlasUVs | null {
  const textureId = getGlobalTextureId(name);
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot) return null;
  return slotIndexToUVs(slot.slotIndex);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if a texture exists in the atlas
 */
export function hasTextureInAtlas(textureId: string): boolean {
  return atlasManager.hasTexture(textureId);
}

/**
 * Get animation info for any texture ID
 */
export function getAnimationInfo(textureId: string): { frameCount: number; frameDelayMs: number; baseSlotIndex: number } | null {
  const slot = atlasManager.getSlotForTexture(textureId);
  if (!slot || slot.metadata.type !== 'animated') return null;

  return {
    frameCount: slot.metadata.frameCount || 1,
    frameDelayMs: slot.metadata.frameDelayMs || 100,
    baseSlotIndex: slot.slotIndex,
  };
}

/**
 * Map tree block type to texture type
 */
export function mapTreeBlockTypeToTextureType(blockType: string): 'trunk' | 'branch' | 'fruit' {
  const lowerType = blockType.toLowerCase();

  switch (lowerType) {
    case 'trunk':
    case 'root':
    case 'fungal_stem':
    case 'fungal_cap_top':
    case 'fungal_cap_underside':
      return 'trunk';
    case 'branch':
    case 'spike':
    case 'nob':
    case 'cross':
    case 'shroom':
    case 'shroom_stem':
    case 'shroom_cap':
      return 'branch';
    case 'fruit':
    case 'leaf':
      return 'fruit';
    default:
      return 'trunk';
  }
}
