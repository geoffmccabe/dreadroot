-- Bump chunk version to force cache invalidation for chunk (3,1)
UPDATE chunk_versions 
SET version = version + 1, updated_at = now()
WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a'
AND chunk_x = 3 AND chunk_z = 1