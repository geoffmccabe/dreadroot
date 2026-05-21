/**
 * Block Type Encoder for Tree Blocks
 * 
 * Encodes tree block metadata (type, depth, tier) into a single string
 * for storage in placed_blocks.block_type column.
 * 
 * Format: {type}_{depth}_{tier}
 * Examples: trunk_0_5, branch_1_3, leaf_2_7
 */

// All valid tree block types - short codes for data efficiency
// Map from short code to full name for display/logic
export const TREE_BLOCK_TYPE_MAP = {
  't': 'trunk',
  'b': 'branch',
  'r': 'root',
  'l': 'leaf',
  's': 'spike',
  'n': 'nob',
  'x': 'cross',
  'sm': 'shroom',
  'ss': 'shroom_stem',
  'sc': 'shroom_cap',
  'fs': 'fungal_stem',
  'fct': 'fungal_cap_top',
  'fcu': 'fungal_cap_underside',
  'ib': 'invisiblock',
  'gb': 'glow_bark',
  'f': 'fruit',
  'shr': 'shrine'
} as const;

// Reverse map for encoding
export const TREE_BLOCK_TYPE_REVERSE_MAP = Object.fromEntries(
  Object.entries(TREE_BLOCK_TYPE_MAP).map(([k, v]) => [v, k])
) as Record<string, string>;

// All valid tree block short codes
export const TREE_BLOCK_SHORT_CODES = Object.keys(TREE_BLOCK_TYPE_MAP) as (keyof typeof TREE_BLOCK_TYPE_MAP)[];

// All valid tree block full names (for backwards compatibility)
export const TREE_BLOCK_TYPES = Object.values(TREE_BLOCK_TYPE_MAP) as readonly string[];

export type TreeBlockType = typeof TREE_BLOCK_TYPES[number];

export interface DecodedBlockType {
  type: string;
  depth: number;
  tier: number;
}

/**
 * Encodes tree block metadata into a single block_type string
 * Uses short codes for data efficiency: t=trunk, b=branch, ib=invisiblock, etc.
 */
export function encodeBlockType(type: string, depth: number, tier: number): string {
  // Convert full type name to short code if available
  const shortCode = TREE_BLOCK_TYPE_REVERSE_MAP[type] || type;
  return `${shortCode}_${depth}_${tier}`;
}

/**
 * Decodes an encoded block_type string back to its components
 * Handles both short codes (t_0_5) and legacy full names (trunk_0_5)
 * Uses string split (not regex) for performance in render loops
 */
export function decodeBlockType(encoded: string): DecodedBlockType | null {
  // Guard: a non-string block_type (e.g. a numeric value from malformed data)
  // would throw "split is not a function" — a parse utility must return null
  // on bad input, never crash the render pass.
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('_');
  
  // Handle simple block types that aren't encoded (e.g., 'fortress_block')
  if (parts.length < 3) {
    return null;
  }
  
  // Handle legacy compound types like 'shroom_stem_0_5' or 'shroom_cap_1_3'
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

  // Handle compound types like 'fungal_stem_0_5' (4 parts: [fungal, stem, depth, tier])
  if (parts.length === 4 && parts[0] === 'fungal') {
    const tier = parseInt(parts[3], 10);
    const depth = parseInt(parts[2], 10);
    if (isNaN(tier) || isNaN(depth)) return null;
    return {
      type: `${parts[0]}_${parts[1]}`,
      depth,
      tier
    };
  }

  // Handle compound types like 'fungal_cap_top_0_5' or 'fungal_cap_underside_0_5'
  // These have 5 or 6 parts
  if (parts.length >= 5 && parts[0] === 'fungal' && parts[1] === 'cap') {
    const tier = parseInt(parts[parts.length - 1], 10);
    const depth = parseInt(parts[parts.length - 2], 10);
    if (isNaN(tier) || isNaN(depth)) return null;
    const typeParts = parts.slice(0, parts.length - 2);
    return {
      type: typeParts.join('_'),
      depth,
      tier
    };
  }
  
  // Standard format: type_depth_tier (3 parts)
  if (parts.length === 3) {
    const depth = parseInt(parts[1], 10);
    const tier = parseInt(parts[2], 10);
    if (isNaN(depth) || isNaN(tier)) return null;
    
    // Convert short code to full name if it's a short code
    const typeCode = parts[0];
    const fullType = TREE_BLOCK_TYPE_MAP[typeCode as keyof typeof TREE_BLOCK_TYPE_MAP] || typeCode;
    
    return {
      type: fullType,
      depth,
      tier
    };
  }
  
  return null;
}

// Result cache for isTreeBlockType — only ~30-50 unique block_type strings exist
// but the function is called 360K+ times per grouping pass (3 passes × 120K blocks).
// Cache turns O(n*m) string operations into O(1) Map lookups after first encounter.
const _isTreeCache = new Map<string, boolean>();

/**
 * Checks if a block_type string represents a tree block
 * Handles both simple types ('trunk'), short codes ('t'), and encoded types ('t_-1_5', 'trunk_-1_5')
 */
export function isTreeBlockType(blockType: string): boolean {
  if (!blockType || typeof blockType !== 'string') return false;

  const cached = _isTreeCache.get(blockType);
  if (cached !== undefined) return cached;

  const result = _isTreeBlockTypeUncached(blockType);
  _isTreeCache.set(blockType, result);
  return result;
}

function _isTreeBlockTypeUncached(blockType: string): boolean {
  // Check if it's a short code directly
  if (blockType in TREE_BLOCK_TYPE_MAP) {
    return true;
  }

  // Check if it's a full type name
  if (TREE_BLOCK_TYPES.includes(blockType)) {
    return true;
  }

  // Try decoding - works for encoded types like 't_-1_5' or 'trunk_-1_5'
  const decoded = decodeBlockType(blockType);
  if (decoded) {
    return TREE_BLOCK_TYPES.includes(decoded.type);
  }

  // Check if blockType STARTS with a short code or full type followed by underscore
  for (const shortCode of TREE_BLOCK_SHORT_CODES) {
    if (blockType.startsWith(`${shortCode}_`)) {
      return true;
    }
  }
  for (const fullType of TREE_BLOCK_TYPES) {
    if (blockType.startsWith(`${fullType}_`)) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the base tree block type from an encoded or simple block_type
 * Returns the FULL type name like 'trunk', 'branch', 'invisiblock' etc.
 * Handles both short codes (ib) and full names
 */
export function getBaseTreeBlockType(blockType: string): string | null {
  if (!blockType || typeof blockType !== 'string') return null;
  
  // Check if it's a short code directly
  if (blockType in TREE_BLOCK_TYPE_MAP) {
    return TREE_BLOCK_TYPE_MAP[blockType as keyof typeof TREE_BLOCK_TYPE_MAP];
  }
  
  // Check if it's already a full tree block type
  if (TREE_BLOCK_TYPES.includes(blockType)) {
    return blockType;
  }
  
  // Try decoding (handles both 't_0_5' and 'trunk_0_5')
  const decoded = decodeBlockType(blockType);
  if (decoded) {
    return decoded.type;
  }
  
  // Fallback: check prefix matching for short codes
  for (const shortCode of TREE_BLOCK_SHORT_CODES) {
    if (blockType.startsWith(`${shortCode}_`)) {
      return TREE_BLOCK_TYPE_MAP[shortCode as keyof typeof TREE_BLOCK_TYPE_MAP];
    }
  }
  
  // Fallback: check prefix matching for full types
  for (const fullType of TREE_BLOCK_TYPES) {
    if (blockType.startsWith(`${fullType}_`)) {
      return fullType;
    }
  }
  
  return null;
}

/**
 * Check if a block_type is an invisiblock (encoded or simple)
 * Handles short code 'ib' and full name 'invisiblock'
 */
export function isInvisiblock(blockType: string): boolean {
  if (!blockType || typeof blockType !== 'string') return false;
  // Quick check for short code or full name
  if (blockType === 'ib' || blockType === 'invisiblock') return true;
  if (blockType.startsWith('ib_') || blockType.startsWith('invisiblock_')) return true;
  // Fallback to full decode
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
    case 'root':
      return trunkTextureUrl;
    case 'branch':
    case 'spike':
    case 'nob':
    case 'cross':
    case 'shroom':
    case 'shroom_stem':
    case 'shroom_cap':
      // Fall back to trunk texture if branch texture is not set
      return branchTextureUrl || trunkTextureUrl;
    case 'fungal_stem':
    case 'fungal_cap_top':
    case 'fungal_cap_underside':
      // Fungal textures handled via atlas UV routing; pass trunk as fallback
      return trunkTextureUrl;
    case 'glow_bark':
      // Glow bark uses trunk texture (rendered with emissive material separately)
      return trunkTextureUrl;
    case 'shrine':
      // Shrines use trunk texture for the tier they appear on
      return trunkTextureUrl;
    case 'leaf':
    case 'fruit':
      // Fall back to branch, then trunk texture
      return fruitTextureUrl || branchTextureUrl || trunkTextureUrl;
    case 'invisiblock':
      return null; // Invisiblocks have no texture
    default:
      return trunkTextureUrl;
  }
}
