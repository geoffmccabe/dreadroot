-- Batched chunk fetch RPC: returns all blocks for a list of chunk coordinates
-- in a single round-trip. Filters expired blocks server-side and omits unused columns
-- to reduce transfer size. Replaces 100-200 individual per-chunk queries with 1-3 calls.

CREATE OR REPLACE FUNCTION fetch_chunks_batch(
  p_world_id UUID,
  p_chunks JSONB  -- Array of {x, z} objects: [{"x":1,"z":2}, {"x":3,"z":4}]
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  position_x REAL,
  position_y REAL,
  position_z REAL,
  block_type TEXT,
  texture_url TEXT,
  branch_depth INTEGER,
  expires_at TIMESTAMPTZ,
  chunk_x INTEGER,
  chunk_z INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pb.id,
    pb.user_id,
    pb.position_x,
    pb.position_y,
    pb.position_z,
    pb.block_type,
    pb.texture_url,
    pb.branch_depth,
    pb.expires_at,
    pb.chunk_x,
    pb.chunk_z
  FROM placed_blocks pb
  INNER JOIN jsonb_to_recordset(p_chunks) AS c(x int, z int)
    ON pb.chunk_x = c.x AND pb.chunk_z = c.z
  WHERE pb.world_id = p_world_id
    AND (pb.expires_at IS NULL OR pb.expires_at > NOW());
END;
$$;

-- Grant execute to authenticated users (standard Supabase pattern)
GRANT EXECUTE ON FUNCTION fetch_chunks_batch(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION fetch_chunks_batch(UUID, JSONB) TO anon;
