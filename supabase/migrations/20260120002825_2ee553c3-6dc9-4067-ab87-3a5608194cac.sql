
-- Final nuclear cleanup of ALL tree-type placed_blocks
DELETE FROM placed_blocks
WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross');

-- Clear all tree_blocks
DELETE FROM tree_blocks;

-- Clear all planted_trees just to be safe
DELETE FROM planted_trees;

-- Bump chunk versions
UPDATE chunk_versions SET version = version + 1;
