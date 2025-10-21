export interface PlacedBlock {
  id: string;
  user_id: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  created_at: string;
  updated_at: string;
}

export interface BlockType {
  id: number;
  key: string;
  name: string;
  description: string;
  cost: number;
  category: 'building' | 'decoration' | 'special';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
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
  quantity: number;
  created_at: string;
  updated_at: string;
}