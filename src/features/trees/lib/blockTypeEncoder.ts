/**
 * Block Type Encoder for Tree Blocks
 * 
 * Encodes tree block metadata (type, depth, tier) into a single string
 * for storage in placed_blocks.block_type column.
 * 
 * Format: {type}_{depth}_{tier}
 * Examples: trunk_0_5, branch_1_3, leaf_2_7
 */

// All valid tree block types
export const TREE_BLOCK_TYPES = [
  'trunk',
  'branch', 
  'leaf',
  'spike',
  'nob',
  'cross',
  'shroom',
  'shroom_stem',
  'shroom_cap',
  'invisiblock',
  'fruit'
] as const;

export type TreeBlockType = typeof TREE_BLOCK_TYPES[number];

export interface DecodedBlockType {
  type: string;
  depth: number;
  tier: number;
}

/**
 * Encodes tree block metadata into a single block_type string
 */
export function encodeBlockType(type: string, depth: number, tier: number): string {
  return `${type}_${depth}_${tier}`;
}

/**
 * Decodes an encoded block_type string back to its components
 * Uses string split (not regex) for performance in render loops
 */
export function decodeBlockType(encoded: string): DecodedBlockType | null {
  const parts = encoded.split('_');
  
  // Handle simple block types that aren't encoded (e.g., 'fortress_block')
  if (parts.length < 3) {
    return null;
  }
  
  // Handle compound types like 'shroom_stem_0_5' or 'shroom_cap_1_3'
  // These have 4 parts: [shroom, stem/cap, depth, tier]
  if (parts.length === 4 && (parts[0] === 'shroom')) {
    const tier = parseInt(parts[3], 10);
    const depth = parseInt(parts[2], 10);
    if (isNaN(tier) || isNaN(depth)) return null;
    return {
      type: `${parts[0]}_${parts[1]}`,
      depth,
      tier
    };
  }
  
  // Standard format: type_depth_tier (3 parts)
  if (parts.length === 3) {
    const depth = parseInt(parts[1], 10);
    const tier = parseInt(parts[2], 10);
    if (isNaN(depth) || isNaN(tier)) return null;
    return {
      type: parts[0],
      depth,
      tier
    };
  }
  
  return null;
}

/**
 * Checks if a block_type string represents a tree block
 * Handles both simple types ('trunk') and encoded types ('trunk_-1_5')
 */
export function isTreeBlockType(blockType: string): boolean {
  if (!blockType) return false;
  
  // First check simple types directly
  if (TREE_BLOCK_TYPES.includes(blockType as TreeBlockType)) {
    return true;
  }
  
  // Try decoding - works for encoded types like 'trunk_-1_5'
  const decoded = decodeBlockType(blockType);
  if (decoded) {
    return TREE_BLOCK_TYPES.includes(decoded.type as TreeBlockType);
  }
  
  // Check if blockType STARTS with a tree block type followed by underscore
  // This catches cases like 'trunk_-1_5' that may not decode properly
  for (const treeType of TREE_BLOCK_TYPES) {
    if (blockType === treeType || blockType.startsWith(`${treeType}_`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Gets the base tree block type from an encoded or simple block_type
 * Returns the base type like 'trunk', 'branch', 'invisiblock' etc.
 */
export function getBaseTreeBlockType(blockType: string): string | null {
  if (!blockType) return null;
  
  // Check if it's already a simple tree block type
  if (TREE_BLOCK_TYPES.includes(blockType as TreeBlockType)) {
    return blockType;
  }
  
  // Try decoding
  const decoded = decodeBlockType(blockType);
  if (decoded) {
    return decoded.type;
  }
  
  // Fallback: check prefix matching for tree types
  for (const treeType of TREE_BLOCK_TYPES) {
    if (blockType.startsWith(`${treeType}_`)) {
      return treeType;
    }
  }
  
  return null;
}

/**
 * Check if a block_type is an invisiblock (encoded or simple)
 */
export function isInvisiblock(blockType: string): boolean {
  return getBaseTreeBlockType(blockType) === 'invisiblock';
}

/**
 * Determines which texture URL to use based on tree block type
 */
export function getTextureUrlForTreeBlock(
  blockType: string,
  trunkTextureUrl: string | null,
  branchTextureUrl: string | null,
  fruitTextureUrl: string | null
): string | null {
  const baseType = getBaseTreeBlockType(blockType);
  
  switch (baseType) {
    case 'trunk':
      return trunkTextureUrl;
    case 'branch':
    case 'spike':
    case 'nob':
    case 'cross':
    case 'shroom':
    case 'shroom_stem':
    case 'shroom_cap':
      return branchTextureUrl;
    case 'leaf':
    case 'fruit':
      return fruitTextureUrl;
    case 'invisiblock':
      return null; // Invisiblocks have no texture
    default:
      return trunkTextureUrl;
  }
}
