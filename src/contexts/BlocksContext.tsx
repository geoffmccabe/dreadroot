import React, { createContext, useContext, ReactNode } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';
import { useAuth } from '@/contexts/AuthContext';

interface BlocksContextType {
  blocks: PlacedBlock[];
  isLoading: boolean;
  placeBlock: (x: number, y: number, z: number, blockType: string, expiresAt?: string) => Promise<PlacedBlock>;
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const blocksHook = usePlacedBlocksWithCache(user?.id || null);
  
  return (
    <BlocksContext.Provider value={blocksHook}>
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