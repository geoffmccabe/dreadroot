
-- Restore placed_blocks for tree_blocks that are missing them (without generated columns)
INSERT INTO placed_blocks (position_x, position_y, position_z, block_type, world_id, user_id)
SELECT 
  tb.position_x, 
  tb.position_y, 
  tb.position_z, 
  tb.block_type, 
  tb.world_id,
  pt.planted_by as user_id
FROM tree_blocks tb
JOIN planted_trees pt ON pt.id = tb.tree_id
WHERE NOT EXISTS (
  SELECT 1 FROM placed_blocks pb
  WHERE pb.position_x = tb.position_x
  AND pb.position_y = tb.position_y
  AND pb.position_z = tb.position_z
  AND pb.world_id = tb.world_id
);

-- Bump chunk versions to force refetch
UPDATE chunk_versions SET version = version + 1;
