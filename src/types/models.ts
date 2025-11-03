export interface AnimationConfig {
  name: string;
  file: string;
  trigger: 'movement' | 'manual' | 'idle' | 'jump' | 'crawl' | 'attack' | 'death';
  speed: number;
  loop: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
}

export interface ModelType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  model_type: 'Character' | 'NPC' | 'Enemy';
  model_url: string;
  file_format: 'fbx' | 'glb' | 'gltf';
  default_scale: number;
  default_scale_x: number;
  default_scale_y: number;
  default_scale_z: number;
  default_color: string;
  animations: AnimationConfig[];
  created_at: string;
  updated_at: string;
  is_active: boolean;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  cost: number;
}
