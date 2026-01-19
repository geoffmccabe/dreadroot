-- Clean up orphan placed_blocks that have no matching tree_blocks
-- These are ghost tree blocks from previous tree growth/deletion race conditions

DELETE FROM placed_blocks
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'invisiblock')
AND NOT EXISTS (
  SELECT 1 FROM tree_blocks tb 
  WHERE tb.position_x = placed_blocks.position_x 
  AND tb.position_y = placed_blocks.position_y 
  AND tb.position_z = placed_blocks.position_z 
  AND tb.world_id = placed_blocks.world_id
);

-- Clean up orphan tree_blocks that have no parent in planted_trees
DELETE FROM tree_blocks
WHERE NOT EXISTS (
  SELECT 1 FROM planted_trees pt 
  WHERE pt.id = tree_blocks.tree_id
);

-- Bump chunk versions to force clients to refetch
UPDATE chunk_versions 
SET version = version + 1, 
    updated_at = NOW();