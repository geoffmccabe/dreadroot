-- Fix: fetch_chunks_batch returned RETURNS TABLE (a set-returning RPC),
-- which PostgREST still caps at its row limit. Large trees (300+ block
-- trees span thousands of blocks across a 50-chunk batch) came back
-- TRUNCATED. The client was already changed to trust cached chunks as
-- complete (===1000 guard removed), so truncated chunks got cached and
-- trusted forever -> trees render permanently incomplete + refetch churn.
--
-- Returning a single jsonb array makes the result ONE scalar value, so
-- PostgREST's row cap cannot truncate it. Same arg signature, so the
-- existing client .rpc('fetch_chunks_batch', { p_world_id, p_chunks })
-- call needs ZERO changes (it already treats `data` as the array).
--
-- branch_depth is intentionally omitted: that column does not exist on
-- placed_blocks (selecting it previously caused HTTP 400). The client
-- does not require it.

-- Return type changes, so the old definition must be dropped first
-- (Postgres refuses CREATE OR REPLACE that changes the return type).
DROP FUNCTION IF EXISTS fetch_chunks_batch(UUID, JSONB);

CREATE FUNCTION fetch_chunks_batch(
  p_world_id UUID,
  p_chunks JSONB  -- Array of {x, z} objects: [{"x":1,"z":2}, {"x":3,"z":4}]
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM (
    SELECT
      pb.id,
      pb.user_id,
      pb.position_x,
      pb.position_y,
      pb.position_z,
      pb.block_type,
      pb.texture_url,
      pb.expires_at,
      pb.chunk_x,
      pb.chunk_z
    FROM placed_blocks pb
    INNER JOIN jsonb_to_recordset(p_chunks) AS c(x int, z int)
      ON pb.chunk_x = c.x AND pb.chunk_z = c.z
    WHERE pb.world_id = p_world_id
      AND (pb.expires_at IS NULL OR pb.expires_at > NOW())
  ) t;
$$;

GRANT EXECUTE ON FUNCTION fetch_chunks_batch(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fetch_chunks_batch(UUID, JSONB) TO anon;
