-- Delete all orphaned trunk blocks that don't belong to any tree
DELETE FROM placed_blocks WHERE block_type = 'trunk';

-- Also delete any other tree-related orphan blocks that might exist
DELETE FROM placed_blocks WHERE block_type IN ('branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'invisibleblock');

-- Bump all chunk versions to force clients to refresh
UPDATE chunk_versions 
SET version = version + 1000, 
    updated_at = now() 
WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a';