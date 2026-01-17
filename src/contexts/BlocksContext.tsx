import React, { createContext, useContext, ReactNode, useMemo, useRef, MutableRefObject } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { useCurrentWorldId, World } from '@/hooks/useCurrentWorldId';
import { organizeBlocksByChunk, blockToChunkKey } from '@/lib/chunkManager';

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
  placeBlock: (x: number, y: number, z: number, blockType: string, expiresAt?: string) => PlacedBlock | null;
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = useUserData();
  const { currentWorldId, currentWorld } = useCurrentWorldId();
  const blocksHook = usePlacedBlocksWithCache(user?.id || null, currentWorldId);
  
  // Visible chunks ref - updated imperatively by CameraTrackedBlocks, read by InstancedBlockGroup
  const visibleChunksRef = useRef<Set<string>>(new Set());
  
  // Organize blocks by chunks for efficient rendering
  const blocksByChunk = useMemo(() => {
    return organizeBlocksByChunk(blocksHook.blocks);
  }, [blocksHook.blocks]);

  // Get visual distance from user profile, default to 4
  const visualDistance = profile?.visual_distance || 4;
  
  // Get fog enabled from user profile, default to true
  const fogEnabled = profile?.fog_enabled ?? true;
  
  const contextValue = {
    ...blocksHook,
    blocksByChunk,
    visibleChunksRef,
    visualDistance,
    fogEnabled,
    currentWorldId,
    currentWorld
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