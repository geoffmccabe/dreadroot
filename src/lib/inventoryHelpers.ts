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
  // For blocks, prioritize entries with item_id=NULL (correct architecture)
  // Then try item_id lookup (for non-block items)
  // Finally fallback to item_type (legacy)
  
  const byItemTypeWithNullId = inventory.find(i => i.item_type === itemKey && i.item_id === null);
  if (byItemTypeWithNullId) return byItemTypeWithNullId;
  
  const byItemId = inventory.find(i => i.item_id === itemKey);
  if (byItemId) return byItemId;
  
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
