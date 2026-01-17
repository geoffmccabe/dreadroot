// Tree System Types - Fully isolated from main codebase

export interface SeedDefinition {
  id: string;
  tier: number;
  name: string;
  trunk_texture_url: string | null;
  branch_texture_url: string | null;
  fruit_texture_url: string | null;
  width_factor: number;
  branching_factor: number;
  fruiting_factor: number;
  growth_factor: number;
  cost: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  created_at: string;
  updated_at: string;
}

export interface PlantedTree {
  id: string;
  world_id: string;
  seed_definition_id: string;
  planted_by: string;
  base_x: number;
  base_y: number;
  base_z: number;
  growth_seed: number;
  current_block_count: number;
  target_block_count: number;
  is_fully_grown: boolean;
  planted_at: string;
  last_growth_at: string;
  // Joined data
  seed_definition?: SeedDefinition;
}

export interface TreeBlock {
  id: string;
  tree_id: string;
  world_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: 'trunk' | 'fruit';
  growth_order: number;
  created_at: string;
}

export interface TreeFruit {
  id: string;
  tree_id: string;
  world_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  tier: number;
  is_falling: boolean;
  is_collectible: boolean;
  velocity_y: number;
  created_at: string;
}

// Blueprint types for generation algorithm
export interface BlueprintBlock {
  x: number;
  y: number;
  z: number;
  type: 'trunk' | 'fruit';
  growthOrder: number;
}

export interface TreeBlueprint {
  blocks: BlueprintBlock[];
  maxHeight: number;
  maxWidth: number;
}

// Physics state for falling fruits
export interface FallingFruitState {
  fruitId: string;
  currentY: number;
  velocity: number;
  targetY: number;
}

// Collision check result
export interface TreeCollisionResult {
  collides: boolean;
  blockId?: string;
  blockType?: 'trunk' | 'fruit';
}
