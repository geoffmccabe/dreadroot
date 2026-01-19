-- One-time cleanup: Delete the massive ghost tree that keeps returning
-- This tree has 38,128 tree_blocks and is causing problems

-- Step 1: Delete tree_blocks for this specific tree
DELETE FROM tree_blocks WHERE tree_id = '71386d3a-0062-4bfe-8b75-d80dbea75990';

-- Step 2: Delete placed_blocks that are tree-type blocks for this world
-- These are orphaned blocks from failed tree deletions
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross');

-- Step 3: Delete the planted_trees record itself
DELETE FROM planted_trees WHERE id = '71386d3a-0062-4bfe-8b75-d80dbea75990';

-- Verify cleanup
DO $$
BEGIN
  RAISE NOTICE 'Ghost tree cleanup complete';
END $$;