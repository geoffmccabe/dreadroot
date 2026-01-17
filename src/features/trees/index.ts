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
export { generateTreeBlueprint, getNextGrowthBlock, estimateGrowthTime } from './lib/treeGrowth';
export { createSeededRandom } from './lib/seededRandom';
export { fruitPhysics, FruitPhysicsSystem } from './lib/fruitPhysics';

// Constants
export { RARITY_COLORS, DEFAULT_TIER_NAMES, getGrowthInterval, getFruitSpawnInterval } from './constants';

// Components
export { SeedDesignPanel } from './components/SeedDesignPanel';
export { SeedPreview } from './components/SeedPreview';


// Hooks
export { useTreeData } from './hooks/useTreeData';
export { useTreeGrowth } from './hooks/useTreeGrowth';
export { useSeedPlanting } from './hooks/useSeedPlanting';
export { useTreeCollision } from './hooks/useTreeCollision';
export { useFruitPickup } from './hooks/useFruitPickup';
