-- Clean up orphaned inventory entries that don't have matching items
-- This removes entries like 'glowing_block' that don't exist in the items table
DELETE FROM public.user_inventory
WHERE item_id IS NULL 
  AND item_type NOT IN (SELECT key FROM public.items);

-- Backfill missing item_id values for existing inventory entries
-- This ensures all inventory entries have proper foreign key relationships
UPDATE public.user_inventory
SET item_id = (
  SELECT id 
  FROM public.items 
  WHERE items.key = user_inventory.item_type
)
WHERE item_id IS NULL
  AND item_type IN (SELECT key FROM public.items);