
-- Delete legacy ghost tree blocks that use un-encoded block_type
-- These are orphaned blocks from old tree system that no longer have parent trees
-- The new system uses encoded types like 't_0_13' (trunk_depth_tier)
DELETE FROM placed_blocks 
WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a'
  AND block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'shroom_stem', 'shroom_cap', 'invisiblock');
