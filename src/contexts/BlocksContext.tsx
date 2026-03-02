import React, { createContext, useContext, ReactNode, useMemo, useRef, MutableRefObject, useEffect } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { useCurrentWorldId, World } from '@/hooks/useCurrentWorldId';
import { getVisibleChunkKeys } from '@/lib/chunkManager';
// B4: Removed organizeBlocksByChunk - now using loadedChunksRef directly
import { CAMERA_START_X, CAMERA_START_Z } from '@/components/fortress/fortressScene.constants';

interface BlocksContextType {
  // Phase 4: Derive blocks lazily from chunks - only used by legacy consumers
  blocks: PlacedBlock[];
  blocksByChunk: Map<string, PlacedBlock[]>;
  /** Ref to visible chunk keys - updated imperatively without React re-renders */
  visibleChunksRef: MutableRefObject<Set<string>>;
  /** Phase 4: World revision counter - use as dependency key for useMemo */
  worldRevision: number;
  /** Phase 4: Direct access to loaded chunks ref */
  loadedChunksRef: MutableRefObject<Map<string, { blocks: PlacedBlock[]; visibleBlocks?: PlacedBlock[] }>>;
  visualDistance: number;
  fogEnabled: boolean;
  isLoading: boolean;
  currentWorldId: string | null;
  currentWorld: World | null;
  worlds: World[];
  setCurrentWorldId: (worldId: string) => void;
  navigateWorld: (direction: 'next' | 'prev') => void;
  worldIndex: { current: number; total: number };
  placeBlock: (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => PlacedBlock | null;
  placeBlocksBatch: (positions: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string; branchDepth?: number }>) => PlacedBlock[];
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
  // Phase 2B: Chunk loading functions
  updatePlayerPosition: (worldX: number, worldZ: number) => Promise<void>;
  initializeForWorld: (startX: number, startZ: number) => Promise<void>;
  getLoadedChunkKeys: () => Set<string>;
  isChunkLoaded: (chunkX: number, chunkZ: number) => boolean;
  refetchSingleChunk: (chunkX: number, chunkZ: number) => Promise<void>;
  removeBlocksByPositions: (positions: Array<{ x: number; y: number; z: number }>) => number;
  LOAD_RADIUS: number;
  UNLOAD_RADIUS: number;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = useUserData();
  const { currentWorldId, currentWorld, worlds, setCurrentWorldId, navigateWorld, worldIndex } = useCurrentWorldId();
  // B5: Pass visual_distance as emitRadius to reduce flatten scope and GC pressure
  // loadRadius = visualDistance + 2 extra rings for fade chunks (grey depth silhouettes)
  const visualDistanceForEmit = profile?.visual_distance || 4;
  // FADE_EXTRA_CHUNKS=0: fade rendering disabled, no need to load extra rings
  const FADE_EXTRA_CHUNKS = 0;
  const blocksHook = usePlacedBlocksWithCache(user?.id || null, currentWorldId, visualDistanceForEmit, visualDistanceForEmit + FADE_EXTRA_CHUNKS);
  
  // Visible chunks ref - updated imperatively by CameraTrackedBlocks, read by InstancedBlockGroup
  // Initialize with starting camera position to ensure blocks render on first frame
  const defaultVisualDistance = profile?.visual_distance || 4;
  const initialVisibleChunks = useMemo(() => {
    return new Set(getVisibleChunkKeys(CAMERA_START_X, CAMERA_START_Z, defaultVisualDistance));
  }, [defaultVisualDistance]);
  const visibleChunksRef = useRef<Set<string>>(initialVisibleChunks);

  // Ensure ref is populated on mount (useRef only uses initial value on first render)
  useEffect(() => {
    if (visibleChunksRef.current.size === 0) {
      visibleChunksRef.current = initialVisibleChunks;
    }
  }, [initialVisibleChunks]);

  // Re-initialize when world changes
  const prevWorldIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentWorldId && currentWorldId !== prevWorldIdRef.current) {
      prevWorldIdRef.current = currentWorldId;
      // Reset visible chunks to starting position when world changes
      const startingChunks = getVisibleChunkKeys(CAMERA_START_X, CAMERA_START_Z, defaultVisualDistance);
      visibleChunksRef.current = new Set(startingChunks);
    }
  }, [currentWorldId, defaultVisualDistance]);
  
  // Phase 4: Build blocksByChunk from loadedChunksRef, keyed by worldRevision
  // This is O(loaded chunks) instead of O(all blocks), and revision triggers efficient recompute
  const blocksByChunk = useMemo(() => {
    const map = new Map<string, PlacedBlock[]>();
    const ref = blocksHook.loadedChunksRef?.current;
    if (!ref) return map;

    for (const [chunkKey, data] of ref.entries()) {
      map.set(chunkKey, data.blocks);
    }
    return map;
  }, [blocksHook.worldRevision]); // Phase 4: Depend on revision, not blocks array

  // Phase 2: Derive flat blocks array from loadedChunksRef for legacy consumers
  // (enemy systems, block removal lookup, UserPanel counts)
  // This replaces the old flatten in doEmit — runs during React render, not RAF
  const blocks = useMemo(() => {
    const ref = blocksHook.loadedChunksRef?.current;
    if (!ref || ref.size === 0) return [] as PlacedBlock[];

    // Use visibleBlocks when available (and non-empty) to reduce array size
    // NOTE: Must check length - empty array [] is not caught by ??
    let total = 0;
    for (const chunkData of ref.values()) {
      const src = chunkData.visibleBlocks?.length ? chunkData.visibleBlocks : chunkData.blocks;
      total += src.length;
    }
    const allBlocks: PlacedBlock[] = new Array(total);
    let idx = 0;
    for (const chunkData of ref.values()) {
      const src = chunkData.visibleBlocks?.length ? chunkData.visibleBlocks : chunkData.blocks;
      for (let i = 0; i < src.length; i++) {
        allBlocks[idx++] = src[i];
      }
    }
    return allBlocks;
  }, [blocksHook.worldRevision]);

  // Get visual distance from user profile, default to 4
  const visualDistance = profile?.visual_distance || 4;
  
  // Get fog enabled from user profile, default to true
  const fogEnabled = profile?.fog_enabled ?? true;
  
  const contextValue: BlocksContextType = {
    blocks, // Phase 2: Derived from loadedChunksRef for legacy consumers (enemy AI, etc.)
    blocksByChunk,
    visibleChunksRef,
    worldRevision: blocksHook.worldRevision, // Phase 4: For dependency tracking
    loadedChunksRef: blocksHook.loadedChunksRef as MutableRefObject<Map<string, { blocks: PlacedBlock[]; visibleBlocks?: PlacedBlock[] }>>, // Phase 4: Direct chunk access
    visualDistance,
    fogEnabled,
    isLoading: blocksHook.isLoading,
    currentWorldId,
    currentWorld,
    worlds,
    setCurrentWorldId,
    navigateWorld,
    worldIndex,
    placeBlock: blocksHook.placeBlock,
    placeBlocksBatch: blocksHook.placeBlocksBatch,
    removeBlock: blocksHook.removeBlock,
    refreshBlocks: blocksHook.refreshBlocks,
    setBlockMode: blocksHook.setBlockMode,
    // Phase 2B: Chunk loading functions
    updatePlayerPosition: blocksHook.updatePlayerPosition,
    initializeForWorld: blocksHook.initializeForWorld,
    getLoadedChunkKeys: blocksHook.getLoadedChunkKeys,
    isChunkLoaded: blocksHook.isChunkLoaded,
    refetchSingleChunk: blocksHook.refetchSingleChunk,
    removeBlocksByPositions: blocksHook.removeBlocksByPositions,
    LOAD_RADIUS: blocksHook.LOAD_RADIUS,
    UNLOAD_RADIUS: blocksHook.UNLOAD_RADIUS
  };
  
  return (
    <BlocksContext.Provider value={contextValue}>
      {children}
    </BlocksContext.Provider>
  );
}

export function useBlocks() {
  const context = useContext(BlocksContext);
  if (context === undefined) {
    throw new Error('useBlocks must be used within a BlocksProvider');
  }
  return context;
}