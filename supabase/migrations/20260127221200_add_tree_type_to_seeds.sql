-- Add tree_type column to seed_definitions
-- Supports: 'original' (current trees), 'wide' (future), 'fungal' (giant mushrooms)
ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS tree_type TEXT DEFAULT 'original';

-- Add comment explaining the field
COMMENT ON COLUMN public.seed_definitions.tree_type IS 'Type of tree: original (standard), wide (future), fungal (giant mushrooms)';

-- Add check constraint for valid values
ALTER TABLE public.seed_definitions
ADD CONSTRAINT seed_definitions_tree_type_check
CHECK (tree_type IN ('original', 'wide', 'fungal'));
