-- Drop the old restrictive constraint
ALTER TABLE tree_blocks DROP CONSTRAINT tree_blocks_block_type_check;

-- Add a new constraint that allows all valid tree block types
ALTER TABLE tree_blocks ADD CONSTRAINT tree_blocks_block_type_check 
CHECK (block_type = ANY (ARRAY['trunk'::text, 'branch'::text, 'fruit'::text, 'spike'::text, 'invisiblock'::text, 'shroom'::text, 'nob'::text, 'cross'::text]));