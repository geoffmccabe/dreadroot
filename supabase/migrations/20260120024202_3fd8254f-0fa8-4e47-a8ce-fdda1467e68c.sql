-- Delete all orphaned tree-type blocks from placed_blocks
-- Since planted_trees and tree_blocks are both empty, ALL tree-type blocks are orphans

DELETE FROM placed_blocks
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'shroom_stem', 'shroom_cap', 'invisiblock');

-- Bump all chunk versions to force clients to refetch clean data
UPDATE chunk_versions 
SET version = version + 1000, 
    updated_at = now()
WHERE chunk_x IS NOT NULL;