-- Bump all chunk versions for the default world to invalidate local caches
UPDATE chunk_versions 
SET version = version + 1000, 
    updated_at = now() 
WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a';