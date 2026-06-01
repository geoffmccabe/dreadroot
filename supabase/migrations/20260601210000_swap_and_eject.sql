-- Add two new RPCs to the unified user_slots system:
--
--   swap_slot           — atomic two-row swap. Used when the cursor
--                         drops onto an occupied slot. Source slot
--                         gets dest's old item; dest slot gets the
--                         cursor item.
--   eject_slot_to_world — atomic delete-from-slot + insert-into-
--                         world_drops. Used when the cursor releases
--                         outside any panel and the item should land
--                         in the world.

-- ────────────────────────────────────────────────────────────────────
-- swap_slot — swap two user_slots rows (or move source if dest empty).
-- Uses a DELETE/UPDATE/INSERT dance to dodge the UNIQUE constraint on
-- (user_id, region, page, slot).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.swap_slot(
  p_from_region       TEXT,
  p_from_page         INTEGER,
  p_from_slot         INTEGER,
  p_to_region         TEXT,
  p_to_page           INTEGER,
  p_to_slot           INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_from           RECORD;
  v_to             RECORD;
  v_from_item_key  TEXT;
  v_to_item_key    TEXT;
  v_to_item_id     UUID;
  v_to_quantity    INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault')
     OR p_to_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;
  IF p_from_region = p_to_region AND p_from_page = p_to_page AND p_from_slot = p_to_slot THEN
    RAISE EXCEPTION 'Source and destination are the same slot' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|slot_swap', 0));

  SELECT * INTO v_from FROM user_slots
   WHERE user_id = v_user_id
     AND region = p_from_region AND page = p_from_page AND slot = p_from_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_to FROM user_slots
   WHERE user_id = v_user_id
     AND region = p_to_region AND page = p_to_page AND slot = p_to_slot
   FOR UPDATE;

  SELECT key INTO v_from_item_key FROM items WHERE id = v_from.item_id;

  -- Dest empty → plain move (caller could've used transfer_slot, but
  -- handle it here too for resilience).
  IF v_to.id IS NULL THEN
    UPDATE user_slots
       SET region = p_to_region, page = p_to_page, slot = p_to_slot, updated_at = NOW()
     WHERE id = v_from.id;
    PERFORM _log_item_history(
      v_user_id, 'swap_move', v_from.item_id, v_from_item_key, 1,
      jsonb_build_object('region', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
      jsonb_build_object('region', p_to_region,   'page', p_to_page,   'slot', p_to_slot),
      p_client_request_id, NULL
    );
    RETURN json_build_object('replayed', false, 'moved', true, 'swapped', false);
  END IF;

  v_to_item_id  := v_to.item_id;
  v_to_quantity := v_to.quantity;
  SELECT key INTO v_to_item_key FROM items WHERE id = v_to_item_id;

  -- Swap dance:
  --   1. DELETE dest row (frees the (to_region, to_page, to_slot) slot)
  --   2. UPDATE source row to dest location
  --   3. INSERT dest's preserved data at source's old location
  -- The DB triggers (region quantity check, etc.) re-validate each
  -- row as it lands at its new home.
  DELETE FROM user_slots WHERE id = v_to.id;

  UPDATE user_slots
     SET region = p_to_region, page = p_to_page, slot = p_to_slot, updated_at = NOW()
   WHERE id = v_from.id;

  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, p_from_region, p_from_page, p_from_slot, v_to_item_id, v_to_quantity);

  PERFORM _log_item_history(
    v_user_id, 'swap', v_from.item_id, v_from_item_key, 1,
    jsonb_build_object('region', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    jsonb_build_object('region', p_to_region,   'page', p_to_page,   'slot', p_to_slot),
    p_client_request_id, NULL
  );
  PERFORM _log_item_history(
    v_user_id, 'swap', v_to_item_id, v_to_item_key, 1,
    jsonb_build_object('region', p_to_region,   'page', p_to_page,   'slot', p_to_slot),
    jsonb_build_object('region', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'swapped', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.swap_slot(
  TEXT, INTEGER, INTEGER, TEXT, INTEGER, INTEGER, UUID
) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- eject_slot_to_world — delete a user_slots row AND insert a
-- world_drops row atomically. The player drags an item out of any
-- panel and releases over the game; the item drops into the world at
-- the player's feet.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eject_slot_to_world(
  p_from_region       TEXT,
  p_from_page         INTEGER,
  p_from_slot         INTEGER,
  p_position_x        REAL,
  p_position_y        REAL,
  p_position_z        REAL,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_from      RECORD;
  v_drop      RECORD;
  v_item_key  TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  SELECT * INTO v_from FROM user_slots
   WHERE user_id = v_user_id
     AND region = p_from_region AND page = p_from_page AND slot = p_from_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_from.item_id;

  INSERT INTO world_drops (item_id, killer_user_id, position_x, position_y, position_z)
  VALUES (v_from.item_id, v_user_id, p_position_x, p_position_y, p_position_z)
  RETURNING * INTO v_drop;

  DELETE FROM user_slots WHERE id = v_from.id;

  PERFORM _log_item_history(
    v_user_id, 'eject_to_world', v_from.item_id, v_item_key, v_from.quantity,
    jsonb_build_object('region', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    jsonb_build_object('kind', 'world_drop', 'drop_id', v_drop.id,
                       'x', p_position_x, 'y', p_position_y, 'z', p_position_z),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'drop_id', v_drop.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.eject_slot_to_world(
  TEXT, INTEGER, INTEGER, REAL, REAL, REAL, UUID
) TO authenticated;
