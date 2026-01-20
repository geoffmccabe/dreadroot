
-- Final cleanup
DELETE FROM placed_blocks WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross');
DELETE FROM tree_blocks;
DELETE FROM planted_trees;
UPDATE chunk_versions SET version = version + 1;
