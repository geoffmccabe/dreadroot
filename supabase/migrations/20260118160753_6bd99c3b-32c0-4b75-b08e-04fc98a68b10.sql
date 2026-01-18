-- NUCLEAR: Delete ALL tree-related blocks immediately
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom');

-- Delete all tree_blocks
DELETE FROM tree_blocks;

-- Add foreign key constraint to prevent orphan tree_blocks
-- First check if constraint already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_tree_blocks_planted_trees'
  ) THEN
    ALTER TABLE tree_blocks 
    ADD CONSTRAINT fk_tree_blocks_planted_trees 
    FOREIGN KEY (tree_id) 
    REFERENCES planted_trees(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- Force massive chunk version bump
UPDATE chunk_versions 
SET version = version + 500000,
    updated_at = now();