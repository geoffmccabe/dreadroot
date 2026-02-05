-- Fix realtime message explosion by batching chunk version updates
-- Problem: Two row-level triggers were firing per block, causing millions of realtime events
-- Solution: Single statement-level trigger that bumps each unique chunk only once per statement

-- Step 1: Drop both existing row-level triggers
DROP TRIGGER IF EXISTS placed_blocks_bump_chunk_version ON public.placed_blocks;
DROP TRIGGER IF EXISTS trg_chunk_versions_on_blocks_change ON public.placed_blocks;

-- Step 2: Create trigger functions for each operation type
-- INSERT trigger function - only has access to new_rows
CREATE OR REPLACE FUNCTION public.chunk_versions_batch_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_chunk RECORD;
BEGIN
  FOR affected_chunk IN
    SELECT DISTINCT world_id, chunk_x, chunk_z
    FROM new_rows
    WHERE world_id IS NOT NULL AND chunk_x IS NOT NULL AND chunk_z IS NOT NULL
  LOOP
    INSERT INTO public.chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
    VALUES (affected_chunk.world_id, affected_chunk.chunk_x, affected_chunk.chunk_z, 1, now())
    ON CONFLICT (world_id, chunk_x, chunk_z)
    DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;

-- UPDATE trigger function - has access to both old_rows and new_rows
CREATE OR REPLACE FUNCTION public.chunk_versions_batch_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_chunk RECORD;
BEGIN
  -- Bump all unique chunks from new positions
  FOR affected_chunk IN
    SELECT DISTINCT world_id, chunk_x, chunk_z
    FROM new_rows
    WHERE world_id IS NOT NULL AND chunk_x IS NOT NULL AND chunk_z IS NOT NULL
  LOOP
    INSERT INTO public.chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
    VALUES (affected_chunk.world_id, affected_chunk.chunk_x, affected_chunk.chunk_z, 1, now())
    ON CONFLICT (world_id, chunk_x, chunk_z)
    DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
  END LOOP;

  -- Also bump old chunks that moved to different chunks (cross-chunk updates)
  FOR affected_chunk IN
    SELECT DISTINCT o.world_id, o.chunk_x, o.chunk_z
    FROM old_rows o
    WHERE o.world_id IS NOT NULL AND o.chunk_x IS NOT NULL AND o.chunk_z IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM new_rows n
      WHERE n.world_id = o.world_id
      AND n.chunk_x = o.chunk_x
      AND n.chunk_z = o.chunk_z
    )
  LOOP
    INSERT INTO public.chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
    VALUES (affected_chunk.world_id, affected_chunk.chunk_x, affected_chunk.chunk_z, 1, now())
    ON CONFLICT (world_id, chunk_x, chunk_z)
    DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
  END LOOP;

  RETURN NULL;
END;
$$;

-- DELETE trigger function - only has access to old_rows
CREATE OR REPLACE FUNCTION public.chunk_versions_batch_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_chunk RECORD;
BEGIN
  FOR affected_chunk IN
    SELECT DISTINCT world_id, chunk_x, chunk_z
    FROM old_rows
    WHERE world_id IS NOT NULL AND chunk_x IS NOT NULL AND chunk_z IS NOT NULL
  LOOP
    INSERT INTO public.chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
    VALUES (affected_chunk.world_id, affected_chunk.chunk_x, affected_chunk.chunk_z, 1, now())
    ON CONFLICT (world_id, chunk_x, chunk_z)
    DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;

-- Step 3: Create statement-level triggers with transition tables
CREATE TRIGGER trg_chunk_versions_batch_insert
AFTER INSERT ON public.placed_blocks
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.chunk_versions_batch_insert();

CREATE TRIGGER trg_chunk_versions_batch_update
AFTER UPDATE ON public.placed_blocks
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.chunk_versions_batch_update();

CREATE TRIGGER trg_chunk_versions_batch_delete
AFTER DELETE ON public.placed_blocks
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.chunk_versions_batch_delete();

-- Step 4: Clean up old trigger functions (no longer needed)
DROP FUNCTION IF EXISTS public.trigger_bump_chunk_version() CASCADE;
DROP FUNCTION IF EXISTS public.chunk_versions_on_blocks_change() CASCADE;

-- Note: bump_chunk_version(uuid, int, int) is kept for explicit calls if needed
