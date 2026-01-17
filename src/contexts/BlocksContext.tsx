import React, { createContext, useContext, ReactNode, useMemo, useRef, MutableRefObject, useEffect } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { useCurrentWorldId, World } from '@/hooks/useCurrentWorldId';
import { organizeBlocksByChunk } from '@/lib/chunkManager';

interface BlocksContextType {
  blocks: PlacedBlock[];
  blocksByChunk: Map<string, PlacedBlock[]>;
  /** Ref to visible chunk keys - updated imperatively without React re-renders */
  visibleChunksRef: MutableRefObject<Set<string>>;
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
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
  // Phase 2B: Chunk loading functions
  updatePlayerPosition: (worldX: number, worldZ: number) => Promise<void>;
  initializeForWorld: (startX: number, startZ: number) => Promise<void>;
  getLoadedChunkKeys: () => Set<string>;
  isChunkLoaded: (chunkX: number, chunkZ: number) => boolean;
  refetchSingleChunk: (chunkX: number, chunkZ: number) => Promise<void>;
  LOAD_RADIUS: number;
  UNLOAD_RADIUS: number;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = useUserData();
  const { currentWorldId, currentWorld, worlds, setCurrentWorldId, navigateWorld, worldIndex } = useCurrentWorldId();
  const blocksHook = usePlacedBlocksWithCache(user?.id || null, currentWorldId);
  
  // Visible chunks ref - updated imperatively by CameraTrackedBlocks, read by InstancedBlockGroup
  const visibleChunksRef = useRef<Set<string>>(new Set());
  
  // Re-initialize when world changes
  const prevWorldIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentWorldId && currentWorldId !== prevWorldIdRef.current) {
      console.log(`[BlocksContext] World changed to ${currentWorldId}, will re-initialize on next player position update`);
      prevWorldIdRef.current = currentWorldId;
      // Clear visible chunks when world changes
      visibleChunksRef.current.clear();
    }
  }, [currentWorldId]);
  
  // Organize blocks by chunks for efficient rendering
  const blocksByChunk = useMemo(() => {
    return organizeBlocksByChunk(blocksHook.blocks);
  }, [blocksHook.blocks]);

  // Get visual distance from user profile, default to 4
  const visualDistance = profile?.visual_distance || 4;
  
  // Get fog enabled from user profile, default to true
  const fogEnabled = profile?.fog_enabled ?? true;
  
  const contextValue: BlocksContextType = {
    blocks: blocksHook.blocks,
    blocksByChunk,
    visibleChunksRef,
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
    removeBlock: blocksHook.removeBlock,
    refreshBlocks: blocksHook.refreshBlocks,
    setBlockMode: blocksHook.setBlockMode,
    // Phase 2B: Chunk loading functions
    updatePlayerPosition: blocksHook.updatePlayerPosition,
    initializeForWorld: blocksHook.initializeForWorld,
    getLoadedChunkKeys: blocksHook.getLoadedChunkKeys,
    isChunkLoaded: blocksHook.isChunkLoaded,
    refetchSingleChunk: blocksHook.refetchSingleChunk,
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