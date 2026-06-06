-- Track 3C/3D: chunk-blob cache for faster world loads (and DO groundwork).
--
-- Today fetch_chunks_batch re-scans + re-aggregates placed_blocks for every
-- requested chunk on every load. Most chunks don't change between loads, so
-- we cache the per-chunk aggregate keyed by the chunk's existing version.
--
-- Cache invalidation reuses the EXISTING chunk_versions trigger — we add NO
-- new trigger to the hot placed_blocks write path (perf trap #1: lazy rebuild
-- only). A cached blob is valid while its stored version == the chunk's
-- current chunk_versions.version. On a miss (changed or never built) the read
-- RPC rebuilds that one chunk and stores it. Cold loads cost the same as
-- before (plus a cache write); warm loads of unchanged chunks skip the scan.

CREATE TABLE IF NOT EXISTS public.chunk_blobs (
  world_id  UUID    NOT NULL,
  chunk_x   INTEGER NOT NULL,
  chunk_z   INTEGER NOT NULL,
  blob      JSONB   NOT NULL,            -- aggregated block rows for the chunk
  version   BIGINT  NOT NULL DEFAULT 0,  -- chunk_versions.version this blob was built from
  built_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, chunk_x, chunk_z)
);

-- Internal cache: no client may touch it directly. RLS on + no policies =>
-- only the SECURITY DEFINER RPC below (which runs as owner) can read/write.
ALTER TABLE public.chunk_blobs ENABLE ROW LEVEL SECURITY;

-- Same input/output shape as fetch_chunks_batch (flat jsonb array of block
-- rows) so the client can swap to it transparently, with a fallback.
CREATE OR REPLACE FUNCTION public.fetch_chunks_cached(
  p_world_id UUID,
  p_chunks   JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result      JSONB := '[]'::jsonb;
  c             RECORD;
  v_cur_version BIGINT;
  v_cached      public.chunk_blobs%ROWTYPE;
  v_found       BOOLEAN;
  v_blob        JSONB;
BEGIN
  FOR c IN SELECT x, z FROM jsonb_to_recordset(p_chunks) AS t(x int, z int) LOOP
    SELECT COALESCE(version, 0) INTO v_cur_version
      FROM chunk_versions
     WHERE world_id = p_world_id AND chunk_x = c.x AND chunk_z = c.z;
    v_cur_version := COALESCE(v_cur_version, 0);

    SELECT * INTO v_cached FROM chunk_blobs
     WHERE world_id = p_world_id AND chunk_x = c.x AND chunk_z = c.z;
    v_found := FOUND;

    IF v_found AND v_cached.version = v_cur_version THEN
      v_blob := v_cached.blob;  -- cache hit
    ELSE
      -- Lazy rebuild this one chunk (same projection as fetch_chunks_batch).
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_blob
      FROM (
        SELECT pb.id, pb.user_id, pb.position_x, pb.position_y, pb.position_z,
               pb.block_type, pb.texture_url, pb.expires_at, pb.chunk_x, pb.chunk_z
        FROM placed_blocks pb
        WHERE pb.world_id = p_world_id AND pb.chunk_x = c.x AND pb.chunk_z = c.z
          AND (pb.expires_at IS NULL OR pb.expires_at > NOW())
      ) t;

      INSERT INTO chunk_blobs (world_id, chunk_x, chunk_z, blob, version, built_at)
      VALUES (p_world_id, c.x, c.z, v_blob, v_cur_version, NOW())
      ON CONFLICT (world_id, chunk_x, chunk_z)
      DO UPDATE SET blob = EXCLUDED.blob, version = EXCLUDED.version, built_at = NOW();
    END IF;

    IF jsonb_array_length(v_blob) > 0 THEN
      v_result := v_result || v_blob;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_chunks_cached(UUID, JSONB) TO authenticated, anon;
