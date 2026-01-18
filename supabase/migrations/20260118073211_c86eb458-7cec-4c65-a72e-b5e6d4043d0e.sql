-- Delete all tree-related data for a clean restart

-- First delete tree_fruits (references planted_trees)
DELETE FROM tree_fruits;

-- Delete tree_blocks (references planted_trees)
DELETE FROM tree_blocks;

-- Delete all trunk blocks from placed_blocks
DELETE FROM placed_blocks WHERE block_type = 'trunk';

-- Finally delete planted_trees
DELETE FROM planted_trees;