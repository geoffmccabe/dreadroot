
-- Delete the badly restored placed_blocks (tree blocks without proper texture)
DELETE FROM placed_blocks
WHERE block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross')
AND (texture_url IS NULL OR texture_url NOT LIKE '%seed_17%');

-- Delete all tree_blocks for this tree (we'll let it regrow fresh)
DELETE FROM tree_blocks WHERE tree_id = '12c094df-a464-4cd4-b712-b95fa74126db';

-- Delete the planted_tree record
DELETE FROM planted_trees WHERE id = '12c094df-a464-4cd4-b712-b95fa74126db';

-- Bump chunk versions
UPDATE chunk_versions SET version = version + 1;
