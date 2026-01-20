
-- Delete orphaned placed_blocks (tree-type blocks with no matching tree_blocks record)
DELETE FROM placed_blocks pb
WHERE pb.block_type IN ('trunk', 'branch', 'fruit', 'spike', 'invisiblock', 'shroom_stem', 'shroom_cap', 'nob', 'cross')
AND NOT EXISTS (
  SELECT 1 FROM tree_blocks tb 
  WHERE tb.position_x = pb.position_x 
  AND tb.position_y = pb.position_y 
  AND tb.position_z = pb.position_z
  AND tb.world_id = pb.world_id
);

-- Bump all chunk versions to force client refetch
UPDATE chunk_versions SET version = version + 1;
