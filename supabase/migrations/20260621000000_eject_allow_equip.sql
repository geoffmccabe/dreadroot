-- Allow the drop-to-world target to eject EQUIPPED items.
-- eject_slot_to_world previously rejected region='equip'; the body is already generic
-- (it works on any (region, page, slot) user_slots row), so we only widen the allow-list.
-- Equip rows are always qty=1, so the single-unit removal path applies unchanged.

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
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault', 'equip') THEN
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

  -- A drop is one unit.
  INSERT INTO world_drops (item_id, killer_user_id, position_x, position_y, position_z)
  VALUES (v_from.item_id, v_user_id, p_position_x, p_position_y, p_position_z)
  RETURNING * INTO v_drop;

  -- Remove exactly one unit from the source (never the whole stack).
  IF v_from.quantity <= 1 THEN
    DELETE FROM user_slots WHERE id = v_from.id;
  ELSE
    UPDATE user_slots SET quantity = quantity - 1, updated_at = NOW()
     WHERE id = v_from.id;
  END IF;

  PERFORM _log_item_history(
    v_user_id, 'eject_to_world', v_from.item_id, v_item_key, 1,
    jsonb_build_object('region', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    jsonb_build_object('kind', 'world_drop', 'drop_id', v_drop.id,
                       'x', p_position_x, 'y', p_position_y, 'z', p_position_z),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'drop_id', v_drop.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.eject_slot_to_world(TEXT, INTEGER, INTEGER, REAL, REAL, REAL, UUID) TO authenticated;
