// Shared types for AdminPanel split files

export interface WaterfallControlsProps {
  settings: any;
  onSettingsChange: (key: string, value: any) => void;
}
export interface UsersListProps {}
export interface UserData {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  has_profile: boolean;
  profile: {
    user_id: string;
    coins: number;
    blockchain_address: string | null;
    visual_distance: number;
    fog_enabled: boolean;
    created_at: string;
  } | null;
  roles: string[];
  inventory_count: number;
  token_balances: { theme_name: string; coins: number }[];
}
export interface AdminBlock {
  id: number;
  key: string;
  name: string;
  description: string;
  cost: number;
  category: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'divine' | 'mystic' | 'rainbow' | 'apocalyptic' | 'infinite';
  class: 'basic' | 'magic' | 'mystery' | 'iconic';
  tier: number;
  texture_url: string | null;
  glow_factor?: number | null;
  properties: {
    size: [number, number, number];
    color: string;
    emissive: boolean;
    transparent: boolean;
  };
}
export interface BlocksListProps {
  userRoles: string[];
}
export interface WeatherControlsProps {
  settings: {
    lightingRange: [number, number];
    cycleDuration: number;
    cloudLayer1?: import('@/components/fortress/FortressTypes').CloudLayerSettings;
    cloudLayer2?: import('@/components/fortress/FortressTypes').CloudLayerSettings;
  };
  onSettingsChange: (key: string, value: any) => void;
}
export interface AdminPanelProps {
  waterfallSettings?: any;
  onWaterfallSettingsChange?: (key: string, value: any) => void;
  onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void;
  onMoveModeChange?: (isMoveMode: boolean) => void;
  weatherSettings?: {
    lightingRange: [number, number];
    cycleDuration: number;
    cloudLayer1?: import('@/components/fortress/FortressTypes').CloudLayerSettings;
    cloudLayer2?: import('@/components/fortress/FortressTypes').CloudLayerSettings;
  };
  onWeatherSettingsChange?: (key: string, value: any) => void;
  viewSettings?: import('@/components/fortress/FortressTypes').ViewSettings;
  onViewSettingsChange?: (settings: import('@/components/fortress/FortressTypes').ViewSettings) => void;
}
