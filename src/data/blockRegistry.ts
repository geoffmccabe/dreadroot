import { BlockType } from '@/types/blocks';

export const BLOCK_REGISTRY: Record<string, BlockType> = {
  fortress_block: {
    id: 1,
    key: 'fortress_block',
    name: 'Fortress Block',
    description: '1x1m block textured like the fortress walls',
    cost: 3,
    category: 'building',
    rarity: 'common',
    texture: {
      diffuse: '/cliff_texture_seamless.webp'
    },
    properties: {
      size: { width: 1, height: 1, depth: 1 },
      color: '#C0C0C0'
    }
  },
  grass_block: {
    id: 2,
    key: 'grass_block',
    name: 'Grass Block',
    description: 'Natural grass-textured building block',
    cost: 2,
    category: 'building',
    rarity: 'common',
    texture: {
      diffuse: '/grass_texture_seamless.webp'
    },
    properties: {
      size: { width: 1, height: 1, depth: 1 },
      color: '#4A8C4A' // Natural grass green color
    }
  },
  glowing_block: {
    id: 3,
    key: 'glowing_block',
    name: 'Glowing Block',
    description: 'Emits a soft magical glow in the darkness',
    cost: 8,
    category: 'decoration',
    rarity: 'rare',
    texture: {
      diffuse: '/cliff_texture_seamless.webp' // Using cliff texture as base, emissive properties will make it glow
    },
    properties: {
      size: { width: 1, height: 1, depth: 1 },
      color: '#FFE135',
      emissive: true
    }
  },
  crystal_block: {
    id: 4,
    key: 'crystal_block',
    name: 'Crystal Block',
    description: 'Translucent crystal with prismatic effects',
    cost: 15,
    category: 'decoration',
    rarity: 'epic',
    texture: {
      diffuse: '/grass_texture_seamless.webp' // Using grass texture as base, will appear crystalline due to transparency and color
    },
    properties: {
      size: { width: 1, height: 1, depth: 1 },
      color: '#00BFFF', // Deep sky blue - pure cyan-blue with no green tones
      transparent: true
    }
  }
};

// Helper functions for working with block types
export const getAllBlocks = (): BlockType[] => {
  return Object.values(BLOCK_REGISTRY);
};

export const getBlockByKey = (key: string): BlockType | undefined => {
  return BLOCK_REGISTRY[key];
};

export const getBlockTexture = (key: string): string => {
  const block = getBlockByKey(key);
  return block?.texture?.diffuse || '/cliff_texture_seamless.webp'; // Fallback texture
};

export const getBlockById = (id: number): BlockType | undefined => {
  return Object.values(BLOCK_REGISTRY).find(block => block.id === id);
};

export const getBlocksByCategory = (category: BlockType['category']): BlockType[] => {
  return Object.values(BLOCK_REGISTRY).filter(block => block.category === category);
};

export const getBlocksByRarity = (rarity: BlockType['rarity']): BlockType[] => {
  return Object.values(BLOCK_REGISTRY).filter(block => block.rarity === rarity);
};

// Block type constants for type safety
export const BLOCK_KEYS = {
  FORTRESS_BLOCK: 'fortress_block',
  GRASS_BLOCK: 'grass_block',
  GLOWING_BLOCK: 'glowing_block',
  CRYSTAL_BLOCK: 'crystal_block'
} as const;

export type BlockKey = keyof typeof BLOCK_REGISTRY;