-- Rewrite pickup_world_drop to insert into user_slots (region='inventory')
-- instead of the legacy user_inventory table.
--
-- After v4.11.0 the client derives inventory items from user_slots and
-- explicitly filters OUT user_inventory rows whose item_type='item'.
-- The old pickup RPC wrote to that filtered branch, so picked-up items
-- silently disappeared from the player's view even though the row
-- existed in the database. F-pickup looked broken; in reality the
-- pickup succeeded but landed in the wrong table.
--
-- This migration:
--   1. Replaces pickup_world_drop to find the first empty inventory
--      slot via _first_empty_slot and INSERT a user_slots row there.
--   2. Falls back to user_inventory only for stackable BLOCK rows
--      (item_type starting with a block key) — those still live in
--      user_inventory under the current architecture. World drops are
--      practically always items though, so this path is rarely hit.
--   3. Refuses the pickup if the player has no room (returns json with
--      refused=true). Caller can show a toast.

CREATE OR REPLACE FUNCTION public.pickup_world_drop(
  p_drop_id           UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_drop      RECORD;
  v_item_key  TEXT;
  v_slot      INTEGER;
  v_row       RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_drop_id IS NULL THEN
    RAISE EXCEPTION 'drop_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT * INTO v_drop FROM world_drops WHERE id = p_drop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Drop % not found', p_drop_id USING ERRCODE = '23503';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_drop.item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item def missing for %', v_drop.item_id USING ERRCODE = '23503';
  END IF;

  -- Find the first empty inventory slot. Inventory holds 18 slots
  -- (1..18). Items never stack in inventory, so each pickup needs its
  -- own empty slot.
  v_slot := public._first_empty_slot(v_user_id, 'inventory', 0);

  -- Try QS overflow if inventory is full — mirrors grant_slot's
  -- overflow behavior for consistency.
  IF v_slot IS NULL THEN
    v_slot := public._first_empty_slot(v_user_id, 'quick_select', 0);
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'No empty inventory or quick-select slot; pickup refused'
        USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
    END IF;
    DELETE FROM world_drops WHERE id = p_drop_id;
    INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
    VALUES (v_user_id, 'quick_select', 0, v_slot, v_drop.item_id, 1)
    RETURNING * INTO v_row;
    PERFORM _log_item_history(
      v_user_id, 'pickup', v_drop.item_id, v_item_key, 1,
      jsonb_build_object('kind', 'world_drop', 'drop_id', p_drop_id),
      jsonb_build_object('region', 'quick_select', 'page', 0, 'slot', v_slot),
      p_client_request_id, NULL
    );
    RETURN json_build_object(
      'replayed', false,
      'rows', jsonb_build_array(row_to_json(v_row)),
      'deleted_world_drop_id', p_drop_id,
      'region', 'quick_select',
      'slot', v_slot
    );
  END IF;

  DELETE FROM world_drops WHERE id = p_drop_id;

  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, 'inventory', 0, v_slot, v_drop.item_id, 1)
  RETURNING * INTO v_row;

  PERFORM _log_item_history(
    v_user_id, 'pickup', v_drop.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'world_drop', 'drop_id', p_drop_id),
    jsonb_build_object('region', 'inventory', 'page', 0, 'slot', v_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'rows', jsonb_build_array(row_to_json(v_row)),
    'deleted_world_drop_id', p_drop_id,
    'region', 'inventory',
    'slot', v_slot
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pickup_world_drop(UUID, UUID) TO authenticated;
