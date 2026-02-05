// Marketplace System Types

export type MarketplaceItemCategory = 'block' | 'fruit' | 'seed' | 'item';

export interface UserDiviBalance {
  id: string;
  user_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceStore {
  id: string;
  user_id: string;
  store_name: string;
  description: string | null;
  banner_url: string | null;
  is_active: boolean;
  total_sales: number;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceListing {
  id: string;
  seller_id: string;
  store_id: string | null;
  item_category: MarketplaceItemCategory;
  item_type: string | null;          // For blocks/seeds (e.g., 'glitter_block', 'seed_tier_5')
  seed_definition_id: string | null;
  seed_tier: number | null;
  fruit_tier: number | null;
  item_id: string | null;
  price_divi: number;
  quantity: number;
  seller_description: string | null;
  expires_at: string | null;
  is_active: boolean;
  views: number;
  created_at: string;
  updated_at: string;
  // Joined data (from queries)
  seller_profile?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  store?: MarketplaceStore | null;
  seed_definition?: {
    id: string;
    name: string;
    tier: number;
    rarity: string;
    trunk_texture_url: string | null;
  } | null;
  block_definition?: {
    key: string;
    name: string;
    category: string;
    rarity: string;
    texture_url: string | null;
  } | null;
}

export interface MarketplaceTransaction {
  id: string;
  listing_id: string;
  seller_id: string;
  buyer_id: string;
  item_category: MarketplaceItemCategory;
  item_type: string | null;          // For blocks/seeds (e.g., 'glitter_block', 'seed_tier_5')
  seed_definition_id: string | null;
  seed_tier: number | null;
  fruit_tier: number | null;
  item_id: string | null;
  quantity: number;
  price_divi: number;
  total_divi: number;
  completed_at: string;
  // Joined data
  seller_profile?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  buyer_profile?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  listing_id: string;
  created_at: string;
  // Joined listing
  listing?: MarketplaceListing;
}

export interface PriceHistoryEntry {
  id: string;
  item_category: MarketplaceItemCategory;
  item_type: string | null;          // For blocks/seeds
  seed_definition_id: string | null;
  seed_tier: number | null;
  fruit_tier: number | null;
  item_id: string | null;
  price_divi: number;
  quantity: number;
  recorded_at: string;
}

// Filter & Sort Types

export interface MarketplaceFilters {
  category?: MarketplaceItemCategory;
  seller_id?: string;
  tier_min?: number;
  tier_max?: number;
  price_min?: number;
  price_max?: number;
  search?: string;
  block_category?: string;  // basic, magic, mystery, iconic
  rarity?: string[];
  expiring_soon?: boolean;  // Show only listings expiring within 24h
}

export type MarketplaceSortOption =
  | 'price_asc'
  | 'price_desc'
  | 'date_asc'
  | 'date_desc'
  | 'expiring_soon'
  | 'tier_asc'
  | 'tier_desc';

export interface MarketplaceSortConfig {
  field: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

// Input types for RPC functions

export interface CreateListingInput {
  item_category: MarketplaceItemCategory;
  price_divi: number;
  quantity: number;
  item_type?: string;              // For blocks (e.g., 'glitter_block') or seeds ('seed_tier_5')
  seed_definition_id?: string;     // For seeds - the actual seed definition UUID
  fruit_tier?: number;
  item_id?: string;
  description?: string;
  expires_at?: string;             // ISO timestamp or null for permanent
}

export interface PurchaseResult {
  success: boolean;
  error?: string;
  transaction_id?: string;
  quantity_purchased?: number;
  total_cost?: number;
  new_balance?: number;
  item_category?: MarketplaceItemCategory;
  required?: number;
  available?: number;
}

export interface CreateListingResult {
  success: boolean;
  error?: string;
  listing_id?: string;
  item_category?: MarketplaceItemCategory;
  quantity?: number;
  price_divi?: number;
  available?: number;
}

export interface CancelListingResult {
  success: boolean;
  error?: string;
  listing_id?: string;
  items_returned?: number;
  item_category?: MarketplaceItemCategory;
}

// UI State Types

export type MarketplaceTab = 'browse' | 'my-listings' | 'my-store' | 'history' | 'watchlist';

export interface MarketplacePanelState {
  activeTab: MarketplaceTab;
  filters: MarketplaceFilters;
  sortOption: MarketplaceSortOption;
  selectedListing: MarketplaceListing | null;
  isCreateModalOpen: boolean;
}

// Display helpers

export function getItemDisplayName(listing: MarketplaceListing): string {
  switch (listing.item_category) {
    case 'block':
      return listing.block_definition?.name || listing.item_type || 'Unknown Block';
    case 'seed':
      return listing.seed_definition?.name || `Tier ${listing.seed_tier} Seed`;
    case 'fruit':
      return `Tier ${listing.fruit_tier} Fruit`;
    case 'item':
      return 'Item'; // TODO: When items table exists
    default:
      return 'Unknown Item';
  }
}

export function getItemTier(listing: MarketplaceListing): number | null {
  switch (listing.item_category) {
    case 'seed':
      return listing.seed_tier;
    case 'fruit':
      return listing.fruit_tier;
    default:
      return null;
  }
}

export function isListingExpiringSoon(listing: MarketplaceListing): boolean {
  if (!listing.expires_at) return false;
  const expiresAt = new Date(listing.expires_at);
  const now = new Date();
  const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  return hoursUntilExpiry <= 24 && hoursUntilExpiry > 0;
}

export function formatDivi(amount: number): string {
  return amount.toLocaleString();
}

export function formatTimeRemaining(expiresAt: string): string {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();

  if (diffMs <= 0) return 'Expired';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
