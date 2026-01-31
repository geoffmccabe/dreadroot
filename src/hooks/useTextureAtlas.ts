/**
 * useTextureAtlas Hook
 *
 * Global texture atlas hook that provides:
 * - Atlas initialization and loading
 * - THREE.js texture from atlas canvas
 * - UV lookups for all texture categories
 * - Texture update/sync functionality
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { atlasManager } from '@/lib/atlasManager';
import { ATLAS_GRID_SIZE } from '@/lib/textureAtlas';
import {
  getTreeUVs,
  getTreeUVsWithAnimation,
  getShwarmUVs,
  getShombieUVs,
  getShnakeUVs,
  getWalapaUVs,
  getBlockUVs,
  getGlobalUVs,
  getTreeTextureId,
  getShwarmTextureId,
  getShombieTextureId,
  getShnakeTextureId,
  getWalapaTextureId,
  getBlockTextureId,
  getGlobalTextureId,
  mapTreeBlockTypeToTextureType,
  getFungalTreeUVs,
  slotIndexToUVs,
  type AtlasUVs,
  type AnimatedAtlasUVs,
} from '@/lib/atlasLookup';
import { decodeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { initLogStartStep, initLogFinishStep } from '@/contexts/InitializationContext';

export interface TextureAtlasState {
  isLoading: boolean;
  isReady: boolean;
  error: Error | null;
  texture: THREE.Texture | null;
  version: number;
  stats: {
    usedSlots: number;
    byCategory: Record<string, number>;
  } | null;
}

// Global texture cache (persists across component remounts)
let globalAtlasTexture: THREE.Texture | null = null;
let globalAtlasReady = false;
let globalAtlasVersion = 0;
let globalInitPromise: Promise<void> | null = null;

/**
 * Get the global atlas texture (for use outside React)
 */
export function getGlobalAtlasTexture(): THREE.Texture | null {
  return globalAtlasTexture;
}

/**
 * Check if atlas is ready (for use outside React)
 */
export function isAtlasReady(): boolean {
  return globalAtlasReady;
}

/**
 * Get current atlas version (for change detection)
 */
export function getAtlasVersion(): number {
  return globalAtlasVersion;
}

/**
 * Increment atlas version (call after syncing textures)
 */
export function incrementAtlasVersion(): void {
  globalAtlasVersion++;
}

/**
 * Pre-initialize the atlas texture (call during app initialization)
 * This ensures the atlas is ready before any components try to render.
 * Returns a promise that resolves when the atlas is fully ready.
 */
export async function initializeAtlasTexture(): Promise<THREE.Texture> {
  // If already initialized, return existing texture
  if (globalAtlasReady && globalAtlasTexture) {
    return globalAtlasTexture;
  }

  // If initialization is in progress, wait for it
  if (globalInitPromise) {
    await globalInitPromise;
    if (globalAtlasTexture) {
      return globalAtlasTexture;
    }
  }

  // Start initialization
  globalInitPromise = (async () => {
    await atlasManager.initialize();

    const canvas = atlasManager.getCanvas();
    if (!canvas) {
      throw new Error('Atlas canvas not available');
    }

    // Create THREE.js texture
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    globalAtlasTexture = texture;
    globalAtlasReady = true;
    globalAtlasVersion = atlasManager.getMetadata()?.version || 1;

    console.log('[TextureAtlas] Pre-initialized atlas texture');
  })();

  await globalInitPromise;
  return globalAtlasTexture!;
}

/**
 * Main hook for accessing the texture atlas
 */
export function useTextureAtlas(): TextureAtlasState & {
  // Tree lookups
  getTreeUVs: (tier: number, type: 'trunk' | 'branch' | 'fruit') => AtlasUVs | null;
  getTreeUVsForBlock: (tier: number, blockType: string) => AtlasUVs | null;

  // Enemy lookups
  getShwarmUVs: (tier: number) => AtlasUVs | null;
  getShombieUVs: (tier: number) => AnimatedAtlasUVs | null;
  getShnakeUVs: (tier: number, part: 'head' | 'body' | 'face') => AnimatedAtlasUVs | null;
  getWalapaUVs: (tier: number, part: 'body' | 'belly' | 'eyes') => AtlasUVs | null;

  // Block/global lookups
  getBlockUVs: (blockType: string) => AtlasUVs | null;
  getGlobalUVs: (name: string) => AtlasUVs | null;

  // Management
  refreshAtlas: () => Promise<void>;
  saveAtlas: () => Promise<void>;
} {
  const [state, setState] = useState<TextureAtlasState>({
    isLoading: true,
    isReady: false,
    error: null,
    texture: null,
    version: 0,
    stats: null,
  });

  const textureRef = useRef<THREE.Texture | null>(null);

  // Sync with global state (handles race conditions)
  useEffect(() => {
    if (state.isReady) return;

    const checkGlobalState = () => {
      if (globalAtlasReady && globalAtlasTexture && !state.isReady) {
        const stats = atlasManager.getStats();
        setState({
          isLoading: false,
          isReady: true,
          error: null,
          texture: globalAtlasTexture,
          version: globalAtlasVersion,
          stats: {
            usedSlots: stats.usedSlots,
            byCategory: stats.byCategory,
          },
        });
        return true;
      }
      return false;
    };

    if (checkGlobalState()) return;

    const interval = setInterval(() => {
      if (checkGlobalState()) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [state.isReady]);

  // Initialize atlas on mount
  useEffect(() => {
    if (globalAtlasReady && globalAtlasTexture) {
      // Already initialized
      const stats = atlasManager.getStats();
      setState({
        isLoading: false,
        isReady: true,
        error: null,
        texture: globalAtlasTexture,
        version: globalAtlasVersion,
        stats: {
          usedSlots: stats.usedSlots,
          byCategory: stats.byCategory,
        },
      });
      return;
    }

    if (globalInitPromise) {
      // Initialization in progress, wait for it
      globalInitPromise.then(() => {
        if (globalAtlasTexture) {
          const stats = atlasManager.getStats();
          setState({
            isLoading: false,
            isReady: true,
            error: null,
            texture: globalAtlasTexture,
            version: globalAtlasVersion,
            stats: {
              usedSlots: stats.usedSlots,
              byCategory: stats.byCategory,
            },
          });
        }
      });
      return;
    }

    // Start initialization
    const initAtlas = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const stepId = initLogStartStep('useTextureAtlas.ts', 'Initializing texture atlas...');

      try {
        globalInitPromise = atlasManager.initialize();
        await globalInitPromise;

        const canvas = atlasManager.getCanvas();
        if (!canvas) {
          throw new Error('Atlas canvas not available');
        }

        // Create THREE.js texture
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        globalAtlasTexture = texture;
        globalAtlasReady = true;
        globalAtlasVersion = atlasManager.getMetadata()?.version || 1;
        textureRef.current = texture;

        const stats = atlasManager.getStats();

        if (stepId) initLogFinishStep(stepId, stats.usedSlots);

        console.log(`[TextureAtlas] Initialized with ${stats.usedSlots} slots`);

        setState({
          isLoading: false,
          isReady: true,
          error: null,
          texture,
          version: globalAtlasVersion,
          stats: {
            usedSlots: stats.usedSlots,
            byCategory: stats.byCategory,
          },
        });
      } catch (error) {
        console.error('[TextureAtlas] Initialization failed:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Atlas initialization failed'),
        }));
      }
    };

    initAtlas();
  }, []);

  // Refresh texture after atlas updates
  const refreshAtlas = useCallback(async () => {
    if (!globalAtlasTexture) return;

    const canvas = atlasManager.getCanvas();
    if (!canvas) return;

    // Update texture from canvas
    globalAtlasTexture.image = canvas;
    globalAtlasTexture.needsUpdate = true;
    globalAtlasVersion = atlasManager.getMetadata()?.version || globalAtlasVersion + 1;

    const stats = atlasManager.getStats();

    setState(prev => ({
      ...prev,
      version: globalAtlasVersion,
      stats: {
        usedSlots: stats.usedSlots,
        byCategory: stats.byCategory,
      },
    }));

    console.log('[TextureAtlas] Refreshed');
  }, []);

  // Save atlas to IndexedDB
  const saveAtlas = useCallback(async () => {
    await atlasManager.save();
    console.log('[TextureAtlas] Saved to IndexedDB');
  }, []);

  // Tree UV lookup with block type mapping
  const getTreeUVsForBlock = useCallback((tier: number, blockType: string): AtlasUVs | null => {
    const textureType = mapTreeBlockTypeToTextureType(blockType);
    return getTreeUVs(tier, textureType);
  }, []);

  return {
    ...state,

    // Tree lookups
    getTreeUVs,
    getTreeUVsForBlock,

    // Enemy lookups
    getShwarmUVs,
    getShombieUVs,
    getShnakeUVs,
    getWalapaUVs,

    // Block/global lookups
    getBlockUVs,
    getGlobalUVs,

    // Management
    refreshAtlas,
    saveAtlas,
  };
}

// ============================================
// CONTEXT-FREE FUNCTIONS (for render loops)
// ============================================

/**
 * Get UVs for a tree block (use in render loops)
 * Decodes tier and type from the encoded block_type string
 *
 * @param encodedBlockType - The encoded block_type string (e.g., 't_-1_5' or 'trunk_0_3')
 * @returns UV offset (always returns valid UVs using deterministic calculation)
 */
export function getInstanceUVsForTreeBlock(
  encodedBlockType: string
): { uvOffsetX: number; uvOffsetY: number } {
  // Decode the block type to get tier and base type
  const decoded = decodeBlockType(encodedBlockType);
  const tier = decoded?.tier ?? 1;
  const baseType = decoded?.type ?? getBaseTreeBlockType(encodedBlockType) ?? 'trunk';

  // Route fungal block types to fungal texture slots
  if (baseType === 'fungal_stem') {
    const uvs = getFungalTreeUVs(tier, 'stem')!;
    return { uvOffsetX: uvs.uvOffsetX, uvOffsetY: uvs.uvOffsetY };
  }
  if (baseType === 'fungal_cap_top') {
    const uvs = getFungalTreeUVs(tier, 'cap_top')!;
    return { uvOffsetX: uvs.uvOffsetX, uvOffsetY: uvs.uvOffsetY };
  }
  if (baseType === 'fungal_cap_underside') {
    const uvs = getFungalTreeUVs(tier, 'cap_underside')!;
    return { uvOffsetX: uvs.uvOffsetX, uvOffsetY: uvs.uvOffsetY };
  }

  const textureType = mapTreeBlockTypeToTextureType(baseType);

  // getTreeUVs always returns valid UVs (uses deterministic slot calculation as fallback)
  const uvs = getTreeUVs(tier, textureType)!;

  return {
    uvOffsetX: uvs.uvOffsetX,
    uvOffsetY: uvs.uvOffsetY,
  };
}

/**
 * Get animation info for a tree block
 * @returns Animation metadata or null if static texture (frameCount <= 1)
 */
export function getTreeBlockAnimationInfo(
  encodedBlockType: string
): { frameCount: number; frameDelayMs: number; baseSlotIndex: number } | null {
  const decoded = decodeBlockType(encodedBlockType);
  const tier = decoded?.tier ?? 1;
  const baseType = decoded?.type ?? getBaseTreeBlockType(encodedBlockType) ?? 'trunk';

  const textureType = mapTreeBlockTypeToTextureType(baseType);
  // getTreeUVsWithAnimation always returns valid data (uses deterministic fallback)
  const animUVs = getTreeUVsWithAnimation(tier, textureType)!;

  if (animUVs.frameCount <= 1) return null;

  return {
    frameCount: animUVs.frameCount,
    frameDelayMs: animUVs.frameDelayMs,
    baseSlotIndex: animUVs.baseSlotIndex,
  };
}

/**
 * Get UV offset for a specific animation frame
 */
export function getAnimatedUVOffset(
  baseSlotIndex: number,
  frameIndex: number
): { uvOffsetX: number; uvOffsetY: number } {
  const actualSlotIndex = baseSlotIndex + frameIndex;
  const uvs = slotIndexToUVs(actualSlotIndex);
  return {
    uvOffsetX: uvs.uvOffsetX,
    uvOffsetY: uvs.uvOffsetY,
  };
}

// Re-export lookup functions for convenience
export {
  getTreeUVs,
  getTreeUVsWithAnimation,
  getShwarmUVs,
  getShombieUVs,
  getShnakeUVs,
  getWalapaUVs,
  getBlockUVs,
  getGlobalUVs,
  getTreeTextureId,
  getShwarmTextureId,
  getShombieTextureId,
  getShnakeTextureId,
  getWalapaTextureId,
  getBlockTextureId,
  getGlobalTextureId,
  mapTreeBlockTypeToTextureType,
  slotIndexToUVs,
  type AtlasUVs,
  type AnimatedAtlasUVs,
};
