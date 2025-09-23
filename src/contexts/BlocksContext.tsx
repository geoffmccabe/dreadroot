import React, { createContext, useContext, ReactNode } from 'react';
import { usePlacedBlocksWithCache } from '@/hooks/usePlacedBlocksWithCache';
import { PlacedBlock } from '@/types/blocks';

interface BlocksContextType {
  blocks: PlacedBlock[];
  isLoading: boolean;
  placeBlock: (x: number, y: number, z: number, blockType: string) => Promise<PlacedBlock>;
  removeBlock: (blockId: string) => Promise<boolean>;
  refreshBlocks: () => Promise<void>;
  setBlockMode: (enabled: boolean) => void;
}

const BlocksContext = createContext<BlocksContextType | undefined>(undefined);

export function BlocksProvider({ children }: { children: ReactNode }) {
  const blocksHook = usePlacedBlocksWithCache();
  
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