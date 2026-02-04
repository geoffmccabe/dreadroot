// Tree System - Main Export File
// Import this single file to use the tree feature

// Feature flag
export { TREE_CONFIG } from './constants';

// Types
export type {
  SeedDefinition,
  PlantedTree,
  TreeBlock,
  TreeFruit,
  BlueprintBlock,
  TreeBlueprint,
  FallingFruitState,
  TreeCollisionResult,
} from './types';

// Core algorithm
export { generateTreeBlueprint, getNextGrowthBlock, estimateGrowthTime, getBlocksAtOrder, getMaxGrowthOrder } from './lib/treeGrowth';
export { generateWideTreeBlueprint, getWideBlocksAtOrder, getWideMaxGrowthOrder } from './lib/wideTreeGenerator';
export { createSeededRandom } from './lib/seededRandom';
export { fruitPhysics, FruitPhysicsSystem } from './lib/fruitPhysics';

// Constants
export { RARITY_COLORS, DEFAULT_TIER_NAMES, getGrowthInterval, getFruitSpawnInterval } from './constants';

// Components
export { SeedDesignPanel } from './components/SeedDesignPanel';
export { SeedPreview } from './components/SeedPreview';


// Hooks
export { useTreeData } from './hooks/useTreeData';
export { useLocalGrowth, deleteTree } from './hooks/useLocalGrowth';
export { useSeedPlanting } from './hooks/useSeedPlanting';
export { useFruitPickup } from './hooks/useFruitPickup';
export { useTreeChopping } from './hooks/useTreeChopping';
