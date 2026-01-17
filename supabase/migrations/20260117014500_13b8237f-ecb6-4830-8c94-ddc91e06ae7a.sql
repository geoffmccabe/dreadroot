-- Phase 2A: Create chunk_versions table for efficient realtime chunk updates

-- 2A.1: Create chunk_versions table with composite primary key
CREATE TABLE public.chunk_versions (
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  chunk_x int NOT NULL,
  chunk_z int NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, chunk_x, chunk_z)
);

-- Index for world-scoped queries (realtime subscription filter)
CREATE INDEX chunk_versions_world_idx ON public.chunk_versions(world_id);

-- 2A.2: Enable RLS with read-only access (no client writes allowed)
ALTER TABLE public.chunk_versions ENABLE ROW LEVEL SECURITY;

-- Anyone can read chunk versions (no private data - just integers)
CREATE POLICY "chunk_versions_read_all"
ON public.chunk_versions
FOR SELECT
USING (true);

-- NO INSERT/UPDATE/DELETE policies - triggers run as table owner, bypassing RLS

-- 2A.3: Helper function to bump a single chunk version (upsert pattern)
CREATE OR REPLACE FUNCTION public.bump_chunk_version(p_world uuid, p_cx int, p_cz int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
  VALUES (p_world, p_cx, p_cz, 1, now())
  ON CONFLICT (world_id, chunk_x, chunk_z)
  DO UPDATE SET
    version = public.chunk_versions.version + 1,
    updated_at = now();
END;
$$;

-- 2A.4: Main trigger function - handles INSERT, DELETE, and UPDATE (with cross-chunk moves)
CREATE OR REPLACE FUNCTION public.chunk_versions_on_blocks_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.bump_chunk_version(NEW.world_id, NEW.chunk_x, NEW.chunk_z);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.bump_chunk_version(OLD.world_id, OLD.chunk_x, OLD.chunk_z);
    RETURN OLD;
  END IF;

  -- UPDATE: Always bump old chunk
  PERFORM public.bump_chunk_version(OLD.world_id, OLD.chunk_x, OLD.chunk_z);

  -- If chunk changed (position or world), also bump new chunk
  IF (NEW.world_id, NEW.chunk_x, NEW.chunk_z) IS DISTINCT FROM (OLD.world_id, OLD.chunk_x, OLD.chunk_z) THEN
    PERFORM public.bump_chunk_version(NEW.world_id, NEW.chunk_x, NEW.chunk_z);
  END IF;

  RETURN NEW;
END;
$$;

-- 2A.5: Attach trigger to placed_blocks table
DROP TRIGGER IF EXISTS trg_chunk_versions_on_blocks_change ON public.placed_blocks;

CREATE TRIGGER trg_chunk_versions_on_blocks_change
AFTER INSERT OR UPDATE OR DELETE ON public.placed_blocks
FOR EACH ROW
EXECUTE FUNCTION public.chunk_versions_on_blocks_change();

-- Enable realtime for chunk_versions table so clients can subscribe
ALTER PUBLICATION supabase_realtime ADD TABLE public.chunk_versions;