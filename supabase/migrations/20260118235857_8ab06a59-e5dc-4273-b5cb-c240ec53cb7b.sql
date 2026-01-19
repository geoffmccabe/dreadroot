-- Fix tree_blocks constraint to include all actual block types used
ALTER TABLE public.tree_blocks DROP CONSTRAINT IF EXISTS tree_blocks_block_type_check;

-- Add constraint with ALL block types actually used in treeGrowth.ts
ALTER TABLE public.tree_blocks ADD CONSTRAINT tree_blocks_block_type_check 
CHECK (block_type = ANY (ARRAY[
  'trunk'::text, 
  'branch'::text, 
  'fruit'::text, 
  'spike'::text, 
  'invisiblock'::text, 
  'shroom'::text,
  'shroom_stem'::text,
  'shroom_cap'::text,
  'nob'::text, 
  'cross'::text
]));