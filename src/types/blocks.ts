export interface PlacedBlock {
  id: string;
  user_id: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  // Optional texture override - used for tree blocks with per-seed textures
  texture_url?: string | null;
}

export interface BlockType {
  id: number;
  key: string;
  name: string;
  description: string;
  cost: number;
  category: 'building' | 'decoration' | 'special';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'divine' | 'mystic' | 'rainbow' | 'apocalyptic' | 'infinite';
  class: 'basic' | 'magic' | 'mystery' | 'iconic';
  tier: number;
  texture?: {
    diffuse?: string;
    normal?: string;
    roughness?: string;
  };
  properties?: {
    size?: { width: number; height: number; depth: number };
    color?: string;
    emissive?: boolean;
    transparent?: boolean;
    glowFactor?: number;
  };
}

export interface InventoryItem {
  id: string;
  user_id: string | null;
  item_type: string;
  item_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
}