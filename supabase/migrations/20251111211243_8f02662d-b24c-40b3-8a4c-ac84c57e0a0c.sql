-- Clean up items table to separate blocks and items
-- Remove all block data from items table (blocks should only be in the blocks table)
DELETE FROM public.items WHERE item_category = 'block';

-- Add index on blocks table key for faster lookups
CREATE INDEX IF NOT EXISTS idx_blocks_key ON public.blocks(key);

-- Add comment to items table to clarify its purpose
COMMENT ON TABLE public.items IS 'Catalog for non-block items (weapons, armor, cosmetics, etc). Blocks are stored in the blocks table.';