// Tree System Types - Fully isolated from main codebase

// Symmetry modes for tree generation
export type SymmetryMode = 'none' | '2xs' | '4r' | '4x2';

// Root styles for buttress roots
export type RootStyle = 'none' | 'steep' | '45deg' | 'shallow';

// Tree type modes
export type TreeType = 'original' | 'wide' | 'fungal';

export interface SeedDefinition {
  id: string;
  tier: number;
  name: string;
  trunk_texture_url: string | null;
  branch_texture_url: string | null;
  fruit_texture_url: string | null;
  trunk_texture_url_ktx2?: string | null;
  branch_texture_url_ktx2?: string | null;
  fruit_texture_url_ktx2?: string | null;
  fungal_stem_texture_url_ktx2?: string | null;
  fungal_cap_top_texture_url_ktx2?: string | null;
  fungal_cap_underside_texture_url_ktx2?: string | null;
  texture_tier?: 'standard' | 'premium';
  width_factor: number;
  branching_factor: number;
  fruiting_factor: number;
  growth_factor: number;
  cost: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  created_at: string;
  updated_at: string;
  // Enhanced decoration factors
  low_branch_height: number;
  spike_chance: number;
  spike_length: number;
  nob_chance: number;
  nob_size: number;
  cross_chance: number;
  cross_length: number;
  shroom_chance: number;
  shroom_length: number;
  shroom_cap_diameter: number;
  // Shrine decoration (rare, for Fruit Forging)
  shrine_chance: number;
  // Symmetry mode
  symmetry: SymmetryMode;
  // Tree type: original (standard), wide (future), fungal (giant mushrooms)
  tree_type: TreeType;
  // Fungal tree textures (only used when tree_type === 'fungal')
  fungal_stem_texture_url: string | null;
  fungal_cap_top_texture_url: string | null;
  fungal_cap_underside_texture_url: string | null;
  // Fungal tree generation settings
  fungal_min_height: number | null;
  fungal_max_height: number | null;
  fungal_min_cap_width: number | null;
  fungal_max_cap_width: number | null;
  fungal_stem_random: number | null;
  fungal_lean_angle: number | null;
  fungal_s_curve: boolean | null;
  // Wide tree generation settings (only used when tree_type === 'wide')
  wide_min_height: number | null;
  wide_max_height: number | null;
  wide_lean_angle: number | null;
  wide_s_curve: boolean | null;
  wide_stem_random: number | null;
  wide_base_trunk_radius: number | null;
  wide_gradient_color_base: string | null;
  wide_gradient_color_tip: string | null;
  wide_glow_color: string | null;
  // Whether this seed appears in the [ ] bracket key cycling menu
  in_bracket_menu: boolean;
  // Root style for buttress roots
  root_style?: RootStyle;
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
  // Joined texture data from seed_definitions via planted_trees
  texture_url?: string | null;
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
  fruit_code?: string; // Extensible fruit type code (#FR1, #FR2, etc.), defaults to 'FR1'
  created_at: string;
}

// A harvested fruit owned by a player (stored in user_fruits table)
export interface UserFruit {
  id: string;
  user_id: string;
  fruit_code: string; // e.g. 'FR1'
  tier: number;
  created_at: string;
}

// Block types for decorations - allows future unique textures per type
// 'invisiblock' = invisible collision block for walkways around decorations
export type TreeBlockType = 'trunk' | 'branch' | 'root' | 'spike' | 'nob' | 'cross' | 'shroom_stem' | 'shroom_cap' | 'fungal_stem' | 'fungal_cap_top' | 'fungal_cap_underside' | 'glow_bark' | 'fruit' | 'invisiblock' | 'shrine';

// Blueprint types for generation algorithm
export interface BlueprintBlock {
  x: number;
  y: number;
  z: number;
  type: TreeBlockType;
  growthOrder: number;
  symmetryGroup?: number; // Blocks in same group grow together
  branchDepth: number; // -1=trunk, 0=main branch, 1=sub, 2=sub-sub, 3=sub-sub-sub
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

// Options for tree growth algorithm
export interface TreeGrowthOptions {
  lowBranchHeight?: number;
  spikeChance?: number;
  spikeLength?: number;
  nobChance?: number;
  nobSize?: number;
  crossChance?: number;
  crossLength?: number;
  shroomChance?: number;
  shroomLength?: number;
  shroomCapDiameter?: number;
  shrineChance?: number;
  symmetry?: SymmetryMode;
  rootStyle?: RootStyle;
}
