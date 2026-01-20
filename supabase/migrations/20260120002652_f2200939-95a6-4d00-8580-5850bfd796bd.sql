
-- Nuclear cleanup: Delete ALL tree-type blocks since no trees exist
DELETE FROM placed_blocks
WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross');

-- Also clean up any remaining tree_blocks
DELETE FROM tree_blocks;

-- Bump chunk versions
UPDATE chunk_versions SET version = version + 1;
