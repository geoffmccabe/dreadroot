import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';
import { useAuth } from '@/contexts/AuthContext';
import { useUserData } from '@/hooks/useUserData';
import { organizeBlocksByChunk } from '@/lib/chunkManager';

interface BlocksContextType {
  blocks: PlacedBlock[];
  blocksByChunk: Map<string, PlacedBlock[]>;
  visualDistance: number;
  fogEnabled: boolean;
  isLoading: boolean;
  placeBlock: (x: number, y: number, z: number, blockType: string, expiresAt?: string) => Promise<PlacedBlock>;
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = useUserData();
  const blocksHook = usePlacedBlocksWithCache(user?.id || null);
  
  // Trigger re-filter every 30s to remove expired blocks without FPS impact
  const [filterTick, setFilterTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setFilterTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);
  
  // Filter out expired blocks client-side to avoid periodic FPS drops
  const activeBlocks = useMemo(() => {
    const now = new Date().toISOString();
    return blocksHook.blocks.filter(block => 
      !block.expires_at || block.expires_at > now
    );
  }, [blocksHook.blocks, filterTick]);
  
  // Organize blocks by chunks for efficient rendering
  const blocksByChunk = useMemo(() => {
    return organizeBlocksByChunk(activeBlocks);
  }, [activeBlocks]);

  // Get visual distance from user profile, default to 4
  const visualDistance = profile?.visual_distance || 4;
  
  // Get fog enabled from user profile, default to true
  const fogEnabled = profile?.fog_enabled ?? true;
  
  const contextValue = {
    ...blocksHook,
    blocks: activeBlocks,
    blocksByChunk,
    visualDistance,
    fogEnabled
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