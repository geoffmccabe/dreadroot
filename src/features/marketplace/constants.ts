// Marketplace System Constants

import type { MarketplaceSortOption, MarketplaceSortConfig } from './types';

// Pagination
export const LISTINGS_PER_PAGE = 20;
export const MAX_LISTINGS_PER_USER = 50;

// Price limits
export const MIN_PRICE_DIVI = 1;
export const MAX_PRICE_DIVI = 999999999;

// Expiration presets (in hours)
export const EXPIRATION_PRESETS = [
  { label: 'Permanent', value: null },
  { label: '1 hour', value: 1 },
  { label: '6 hours', value: 6 },
  { label: '12 hours', value: 12 },
  { label: '1 day', value: 24 },
  { label: '3 days', value: 72 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
] as const;

// Sort options for UI
export const SORT_OPTIONS: { value: MarketplaceSortOption; label: string }[] = [
  { value: 'date_desc', label: 'Recently Listed' },
  { value: 'date_asc', label: 'Oldest First' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'tier_desc', label: 'Tier: High to Low' },
  { value: 'tier_asc', label: 'Tier: Low to High' },
  { value: 'expiring_soon', label: 'Expiring Soon' },
];

// Map sort option to query config
export const SORT_CONFIG: Record<MarketplaceSortOption, MarketplaceSortConfig> = {
  price_asc: { field: 'price_divi', ascending: true },
  price_desc: { field: 'price_divi', ascending: false },
  date_asc: { field: 'created_at', ascending: true },
  date_desc: { field: 'created_at', ascending: false },
  tier_asc: { field: 'seed_tier', ascending: true, nullsFirst: false },
  tier_desc: { field: 'seed_tier', ascending: false, nullsFirst: false },
  expiring_soon: { field: 'expires_at', ascending: true, nullsFirst: false },
};

// Category labels
export const CATEGORY_LABELS = {
  block: 'Blocks',
  fruit: 'Fruits',
  seed: 'Seeds',
  item: 'Items',
} as const;

// Rarity colors (matching existing system)
export const RARITY_COLORS = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
  mythic: '#ef4444',
} as const;

// Block categories for filtering
export const BLOCK_CATEGORIES = [
  { value: 'basic', label: 'Basic' },
  { value: 'magic', label: 'Magic' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'iconic', label: 'Iconic' },
] as const;

// Fruit tier names (matching trees/constants.ts)
export const FRUIT_TIER_NAMES = [
  '', // index 0 unused
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Divine',
  'Mystic',
  'Rainbow',
  'Apocalyptic',
  'Cosmic',
] as const;

export function getFruitTierName(tier: number): string {
  if (tier >= 1 && tier < FRUIT_TIER_NAMES.length) {
    return FRUIT_TIER_NAMES[tier];
  }
  return `Tier ${tier}`;
}

// Store configuration
export const STORE_NAME_MAX_LENGTH = 50;
export const STORE_DESCRIPTION_MAX_LENGTH = 500;
export const LISTING_DESCRIPTION_MAX_LENGTH = 300;

// UI dimensions
export const MARKETPLACE_PANEL_WIDTH = 900;
export const MARKETPLACE_PANEL_HEIGHT = 720;
export const LISTING_CARD_HEIGHT = 160;
