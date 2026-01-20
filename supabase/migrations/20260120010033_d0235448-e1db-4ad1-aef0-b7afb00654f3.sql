-- Nuclear cleanup of ALL tree-related blocks (ghost tree in progress)
-- Deletes all tree-type placed_blocks, all tree_blocks, all planted_trees

DELETE FROM tree_fruits;
DELETE FROM tree_blocks;
DELETE FROM planted_trees;
DELETE FROM placed_blocks WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross');

-- Bump all chunk versions to force client refresh
UPDATE chunk_versions SET version = version + 1;