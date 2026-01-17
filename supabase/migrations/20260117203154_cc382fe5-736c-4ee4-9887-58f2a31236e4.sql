-- Update check constraint to allow 'trunk' and 'leaf' block types
ALTER TABLE tree_blocks DROP CONSTRAINT tree_blocks_block_type_check;
ALTER TABLE tree_blocks ADD CONSTRAINT tree_blocks_block_type_check CHECK (block_type = ANY (ARRAY['trunk'::text, 'leaf'::text]));