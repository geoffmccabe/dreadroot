-- Track 1B (L1 write API): route block placement + mining through validated
-- RPCs instead of direct client writes to placed_blocks. SECURITY DEFINER so
-- the integrity checks run server-side and can't be bypassed; ownership is
-- enforced here (not just RLS). Client keeps its optimistic local placement —
-- these are still fire-and-forget, so FPS is unaffected.
--
-- Behavior is preserved exactly:
--   place_block = the existing world-scoped upsert (inventory consumption stays
--                 a separate consume_inventory_target call, unchanged).
--   mine_block  = the existing delete + overlap-check enqueue. Mining does NOT
--                 grant the block back (matches current behavior; changing that
--                 is a separate gameplay decision).
--
-- The admin "inspector delete that returns the block to its owner"
-- (Fortress.tsx) is a DIFFERENT operation and is intentionally not covered here.

-- Spatial-bounds source for world writes. Nullable: when unset, no bound is
-- enforced (so this can't wrongly reject existing placements). Track 7 will
-- populate per-world values. Forward-compat: RPCs read this column, never an
-- inline coordinate literal.
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS bounds INTEGER;

-- ── place_block ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_block(
  p_world_id    UUID,
  p_x           DOUBLE PRECISION,
  p_y           DOUBLE PRECISION,
  p_z           DOUBLE PRECISION,
  p_block_type  TEXT,
  p_texture_url TEXT DEFAULT NULL,
  p_expires_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bounds  INTEGER;
  v_row     RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_block_type IS NULL OR p_block_type = '' THEN
    RAISE EXCEPTION 'block_type required' USING ERRCODE = '22023';
  END IF;
  IF p_world_id IS NULL THEN
    RAISE EXCEPTION 'world_id required' USING ERRCODE = '22023';
  END IF;

  SELECT bounds INTO v_bounds FROM worlds WHERE id = p_world_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'World % not found', p_world_id USING ERRCODE = '23503';
  END IF;
  -- Bound from the worlds row (never inline). Only enforced when set.
  IF v_bounds IS NOT NULL AND (abs(p_x) > v_bounds OR abs(p_z) > v_bounds) THEN
    RAISE EXCEPTION 'Position out of world bounds' USING ERRCODE = '23514';
  END IF;

  -- World-scoped upsert by position. user_id is the caller — a client can
  -- never place (or re-own) a block as another user. Matches the prior
  -- upsert's onConflict + last-writer-owns semantics.
  INSERT INTO placed_blocks (user_id, world_id, position_x, position_y, position_z,
                             block_type, texture_url, expires_at)
  VALUES (v_user_id, p_world_id, p_x, p_y, p_z, p_block_type, p_texture_url, p_expires_at)
  ON CONFLICT (world_id, position_x, position_y, position_z)
  DO UPDATE SET user_id     = v_user_id,
                block_type  = EXCLUDED.block_type,
                texture_url = EXCLUDED.texture_url,
                expires_at  = EXCLUDED.expires_at,
                updated_at  = NOW()
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_block(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ── mine_block ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mine_block(
  p_block_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_block    RECORD;
  v_is_admin BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_block FROM placed_blocks WHERE id = p_block_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Idempotent: already gone (e.g. duplicate fire). Not an error.
    RETURN json_build_object('removed', false, 'reason', 'not_found');
  END IF;

  v_is_admin := has_role(v_user_id, 'admin'::app_role)
             OR has_role(v_user_id, 'superadmin'::app_role);
  IF v_block.user_id <> v_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'You can only remove blocks you placed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM placed_blocks WHERE id = p_block_id;

  -- Tree-hole fill queue for above-ground removals (matches client behavior).
  IF v_block.position_y > 0 AND v_block.world_id IS NOT NULL THEN
    INSERT INTO overlap_check_queue (world_id, position_x, position_y, position_z, added_by)
    VALUES (v_block.world_id, floor(v_block.position_x), floor(v_block.position_y),
            floor(v_block.position_z), v_user_id)
    ON CONFLICT (world_id, position_x, position_y, position_z) DO NOTHING;
  END IF;

  RETURN json_build_object('removed', true, 'block_id', p_block_id,
                           'world_id', v_block.world_id,
                           'x', v_block.position_x, 'y', v_block.position_y, 'z', v_block.position_z);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mine_block(UUID) TO authenticated;
