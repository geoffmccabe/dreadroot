/**
 * Helper utilities for inventory management
 * Supports both legacy item_type and new item_id lookups
 */

import { UserInventoryItem } from '@/hooks/useUserData';

/**
 * Find inventory item by either item_type (legacy) or item_id (new)
 * Prefers item_id lookup when available for data integrity
 */
export function findInventoryItem(
  inventory: UserInventoryItem[],
  itemKey: string
): UserInventoryItem | undefined {
  // Try item_id first (UUID foreign key - preferred)
  const byItemId = inventory.find(i => i.item_id === itemKey);
  if (byItemId) return byItemId;
  
  // Fallback to item_type (legacy string key)
  return inventory.find(i => i.item_type === itemKey);
}

/**
 * Get quantity of an item in inventory
 */
export function getInventoryQuantity(
  inventory: UserInventoryItem[],
  itemKey: string
): number {
  const item = findInventoryItem(inventory, itemKey);
  return item?.quantity || 0;
}

/**
 * Check if user has any quantity of an item
 */
export function hasInventoryItem(
  inventory: UserInventoryItem[],
  itemKey: string
): boolean {
  return getInventoryQuantity(inventory, itemKey) > 0;
}
