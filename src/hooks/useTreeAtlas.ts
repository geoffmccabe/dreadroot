/**
 * useTreeAtlas Hook
 *
 * Manages the tree texture atlas lifecycle:
 * - Generates atlas from seed definitions
 * - Creates THREE.js texture
 * - Provides UV lookup for tree blocks
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  atlasRegistry,
  getTreeTextureId,
  getSlotUVs,
  ATLAS_SLOT_SIZE,
  ATLAS_GRID_SIZE,
  type AtlasEntry,
} from '@/lib/textureAtlas';
import {
  generateFullTreeAtlas,
  type AtlasGenerationResult,
} from '@/lib/textureAtlasGenerator';
import { decodeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { initLogStartStep, initLogFinishStep } from '@/contexts/InitializationContext';

export interface TreeAtlasState {
  isLoading: boolean;
  isReady: boolean;
  error: Error | null;
  texture: THREE.Texture | null;
  atlasId: number;
  stats: {
    loadedTextures: number;
    placeholderTextures: number;
    usedSlots: number;
  } | null;
}

export interface TreeAtlasUVs {
  uvOffsetX: number;
  uvOffsetY: number;
  uvScaleX: number;
  uvScaleY: number;
}

// Global atlas texture cache (persists across component remounts)
let globalAtlasTexture: THREE.Texture | null = null;
let globalAtlasReady = false;
let globalAtlasPromise: Promise<AtlasGenerationResult> | null = null;

/**
 * Get UV offset and scale for a tree texture
 * Returns values to use with texture.offset and texture.repeat
 */
export function getTreeUVs(tier: number, type: 'trunk' | 'branch' | 'fruit'): TreeAtlasUVs | null {
  const entry = atlasRegistry.getEntry(getTreeTextureId(tier, type));
  if (!entry) return null;

  const slotSize = 1 / ATLAS_GRID_SIZE;

  return {
    uvOffsetX: entry.slot.uvMinX,
    uvOffsetY: entry.slot.uvMinY,
    uvScaleX: slotSize,
    uvScaleY: slotSize,
  };
}

/**
 * Get the global atlas texture (if ready)
 */
export function getGlobalAtlasTexture(): THREE.Texture | null {
  return globalAtlasTexture;
}

/**
 * Check if atlas is ready
 */
export function isAtlasReady(): boolean {
  return globalAtlasReady;
}

/**
 * Hook to use the tree texture atlas
 */
export function useTreeAtlas(): TreeAtlasState & {
  getUVsForBlock: (tier: number, blockType: string) => TreeAtlasUVs | null;
  regenerateAtlas: () => Promise<void>;
} {
  const [state, setState] = useState<TreeAtlasState>({
    isLoading: true,
    isReady: false,
    error: null,
    texture: null,
    atlasId: 1,
    stats: null,
  });

  const textureRef = useRef<THREE.Texture | null>(null);

  // Fetch seed definitions from database
  const { data: seedDefinitions, isLoading: isLoadingSeeds } = useQuery({
    queryKey: ['seed-definitions-for-atlas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seed_definitions')
        .select('tier, trunk_texture_url, branch_texture_url, fruit_texture_url')
        .order('tier', { ascending: true });

      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Synchronization effect: periodically check if global atlas is ready
  // This fixes race conditions where setState gets lost due to component remounting
  useEffect(() => {
    // If already ready in local state, no need to poll
    if (state.isReady) return;

    const checkGlobalState = () => {
      if (globalAtlasReady && globalAtlasTexture && !state.isReady) {
        console.log('[TreeAtlas] Sync: Global atlas ready, updating local state');
        setState({
          isLoading: false,
          isReady: true,
          error: null,
          texture: globalAtlasTexture,
          atlasId: 1,
          stats: null,
        });
        return true; // Ready, stop polling
      }
      return false;
    };

    // Check immediately
    if (checkGlobalState()) return;

    // Poll until ready (fixes race condition)
    const interval = setInterval(() => {
      if (checkGlobalState()) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [state.isReady]);

  // Generate atlas when seed definitions are loaded
  useEffect(() => {
    if (isLoadingSeeds || !seedDefinitions) return;

    // If already ready, just use the global texture
    if (globalAtlasReady && globalAtlasTexture) {
      setState({
        isLoading: false,
        isReady: true,
        error: null,
        texture: globalAtlasTexture,
        atlasId: 1,
        stats: null, // Stats not available from cache
      });
      return;
    }

    // If generation is in progress, wait for it
    if (globalAtlasPromise) {
      globalAtlasPromise.then((result) => {
        if (globalAtlasTexture) {
          setState({
            isLoading: false,
            isReady: true,
            error: null,
            texture: globalAtlasTexture,
            atlasId: result.atlasId,
            stats: {
              loadedTextures: result.stats.loadedTextures,
              placeholderTextures: result.stats.placeholderTextures,
              usedSlots: result.stats.usedSlots,
            },
          });
        }
      });
      return;
    }

    // Generate the atlas
    const generateAtlas = async () => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      // Log atlas generation to init overlay
      const atlasStepId = initLogStartStep('useTreeAtlas.ts', 'Generating tree texture atlas...');

      try {
        globalAtlasPromise = generateFullTreeAtlas(1, seedDefinitions);
        const result = await globalAtlasPromise;

        // Create THREE.js texture from canvas
        const texture = new THREE.CanvasTexture(result.canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;

        // Store globally
        globalAtlasTexture = texture;
        globalAtlasReady = true;
        textureRef.current = texture;

        // Finish atlas step with slot count
        if (atlasStepId) initLogFinishStep(atlasStepId, result.stats.usedSlots);

        console.log('[TreeAtlas] Generated atlas with', result.stats.usedSlots, 'slots');

        setState({
          isLoading: false,
          isReady: true,
          error: null,
          texture,
          atlasId: result.atlasId,
          stats: {
            loadedTextures: result.stats.loadedTextures,
            placeholderTextures: result.stats.placeholderTextures,
            usedSlots: result.stats.usedSlots,
          },
        });

        console.log('[TreeAtlas] setState called - component should re-render');
      } catch (error) {
        console.error('[TreeAtlas] Failed to generate atlas:', error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Atlas generation failed'),
        }));
      }
    };

    generateAtlas();
  }, [seedDefinitions, isLoadingSeeds]);

  // Get UVs for a specific block type
  const getUVsForBlock = useCallback((tier: number, blockType: string): TreeAtlasUVs | null => {
    // Map block types to texture types
    let textureType: 'trunk' | 'branch' | 'fruit';

    switch (blockType.toLowerCase()) {
      case 'trunk':
      case 'root':
        textureType = 'trunk';
        break;
      case 'branch':
      case 'spike':
      case 'nob':
      case 'cross':
      case 'shroom_stem':
      case 'shroom_cap':
        textureType = 'branch';
        break;
      case 'fruit':
      case 'leaf':
        textureType = 'fruit';
        break;
      default:
        textureType = 'trunk'; // Default fallback
    }

    return getTreeUVs(tier, textureType);
  }, []);

  // Regenerate atlas (e.g., after texture upload)
  const regenerateAtlas = useCallback(async () => {
    if (!seedDefinitions) return;

    // Clear globals to force regeneration
    globalAtlasReady = false;
    globalAtlasPromise = null;

    // Dispose old texture
    if (globalAtlasTexture) {
      globalAtlasTexture.dispose();
      globalAtlasTexture = null;
    }

    // Clear registry
    atlasRegistry.clear();

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      globalAtlasPromise = generateFullTreeAtlas(1, seedDefinitions);
      const result = await globalAtlasPromise;

      const texture = new THREE.CanvasTexture(result.canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;

      globalAtlasTexture = texture;
      globalAtlasReady = true;
      textureRef.current = texture;

      setState({
        isLoading: false,
        isReady: true,
        error: null,
        texture,
        atlasId: result.atlasId,
        stats: {
          loadedTextures: result.stats.loadedTextures,
          placeholderTextures: result.stats.placeholderTextures,
          usedSlots: result.stats.usedSlots,
        },
      });
    } catch (error) {
      console.error('[TreeAtlas] Failed to regenerate atlas:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error : new Error('Atlas regeneration failed'),
      }));
    }
  }, [seedDefinitions]);

  return {
    ...state,
    getUVsForBlock,
    regenerateAtlas,
  };
}

/**
 * Context-free function to get UVs for instanced rendering
 * Use this in render loops where hooks can't be used
 *
 * @param encodedBlockType - The encoded block_type string (e.g., 't_-1_5' or 'trunk_0_3')
 * @returns UV offset or null if atlas not ready
 */
/**
 * Map block type to texture type
 */
function mapBlockTypeToTextureType(baseType: string): 'trunk' | 'branch' | 'fruit' {
  switch (baseType.toLowerCase()) {
    case 'trunk':
    case 'root':
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

export function getInstanceUVsForTreeBlock(
  encodedBlockType: string
): { uvOffsetX: number; uvOffsetY: number } | null {
  if (!globalAtlasReady) return null;

  // Decode the block type to get tier and base type
  const decoded = decodeBlockType(encodedBlockType);
  const tier = decoded?.tier ?? 1;
  const baseType = decoded?.type ?? getBaseTreeBlockType(encodedBlockType) ?? 'trunk';

  const textureType = mapBlockTypeToTextureType(baseType);

  const uvs = getTreeUVs(tier, textureType);
  if (!uvs) return null;

  return {
    uvOffsetX: uvs.uvOffsetX,
    uvOffsetY: uvs.uvOffsetY,
  };
}

/**
 * Get animation info for a tree block
 * @returns Animation metadata or null if static texture
 */
export function getTreeBlockAnimationInfo(
  encodedBlockType: string
): { frameCount: number; frameDelayMs: number; baseSlotIndex: number } | null {
  if (!globalAtlasReady) return null;

  const decoded = decodeBlockType(encodedBlockType);
  const tier = decoded?.tier ?? 1;
  const baseType = decoded?.type ?? getBaseTreeBlockType(encodedBlockType) ?? 'trunk';

  const textureType = mapBlockTypeToTextureType(baseType);
  const entry = atlasRegistry.getEntry(getTreeTextureId(tier, textureType));

  if (!entry || entry.type !== 'animated') return null;

  return {
    frameCount: entry.frameCount ?? 1,
    frameDelayMs: entry.frameDelayMs ?? 100,
    baseSlotIndex: entry.slot.slotIndex,
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
  const uvs = getSlotUVs(actualSlotIndex);
  return {
    uvOffsetX: uvs.uvMinX,
    uvOffsetY: uvs.uvMinY,
  };
}
