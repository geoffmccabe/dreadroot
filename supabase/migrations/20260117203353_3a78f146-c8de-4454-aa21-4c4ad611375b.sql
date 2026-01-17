-- First drop the constraint, then update data, then add correct constraint
ALTER TABLE tree_blocks DROP CONSTRAINT tree_blocks_block_type_check;
UPDATE tree_blocks SET block_type = 'fruit' WHERE block_type IN ('leaf', 'branch');
ALTER TABLE tree_blocks ADD CONSTRAINT tree_blocks_block_type_check CHECK (block_type = ANY (ARRAY['trunk'::text, 'fruit'::text]));