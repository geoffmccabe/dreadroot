-- Fix: picked-up Shpider eggs never appeared in the inventory.
--
-- Same regression that hit pickup_world_drop (see 20260602100000): after
-- v4.11.0 the client derives inventory ITEMS from user_slots and explicitly
-- filters OUT user_inventory rows whose item_type='item' (useUserData.ts
-- ~line 226). pickup_egg was left behind still INSERTing the egg into
-- user_inventory with item_type='item', so the pickup succeeded in the DB
-- but landed in the filtered branch and was invisible to the player.
-- pickup_world_drop was unified to user_slots on 2026-06-02; pickup_egg was
-- not. This migration brings pickup_egg in line.
--
-- Behavior now mirrors pickup_world_drop_unified:
--   * Find the first empty 'inventory' slot via _first_empty_slot; overflow
--     to 'quick_select'; refuse (raise) if both are full — the world egg is
--     left in place so nothing is lost.
--   * Insert into user_slots (region/page/slot), not user_inventory.
--   * Eggs are non-stackable (one row per egg), so each pickup takes its own
--     slot — no stacking branch needed.
--   * The legacy pickup cooldown (items.pickup_cooldown_seconds -> a
--     user_inventory.cooldown_until column) is dropped: user_slots has no
--     cooldown column and the client already abandoned per-row egg cooldown
--     enforcement once eggs moved into the slot/QS model (Fortress.tsx notes
--     "cooldown enforcement on QS-stored eggs is currently lost").

CREATE OR REPLACE FUNCTION public.pickup_egg(
  p_world_egg_id      UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_egg       RECORD;
  v_item_id   UUID;
  v_item_key  TEXT;
  v_slot      INTEGER;
  v_region    TEXT := 'inventory';
  v_row       RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_world_egg_id IS NULL THEN
    RAISE EXCEPTION 'world_egg_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_world_egg_id', null, 'replayed', true);
  END IF;

  -- Lock the world egg.
  SELECT * INTO v_egg FROM world_eggs WHERE id = p_world_egg_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'World egg % not found', p_world_egg_id USING ERRCODE = '23503';
  END IF;
  IF v_egg.owner_user_id IS NOT NULL AND v_egg.owner_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Egg belongs to another user' USING ERRCODE = '42501';
  END IF;

  -- Resolve the item. Prefer the explicit item_id; fall back to
  -- 'shpider_egg_t<tier>' for legacy rows not yet backfilled.
  v_item_id := v_egg.item_id;
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM items WHERE key = 'shpider_egg_t' || v_egg.tier::text;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Item lookup failed for egg %', v_egg.id USING ERRCODE = '23503';
    END IF;
  END IF;
  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;

  -- Find room BEFORE deleting the world egg, so a refused pickup leaves the
  -- egg in the world (nothing lost). Inventory first, then QS overflow.
  v_slot := public._first_empty_slot(v_user_id, 'inventory', 0);
  IF v_slot IS NULL THEN
    v_region := 'quick_select';
    v_slot := public._first_empty_slot(v_user_id, 'quick_select', 0);
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'No empty inventory or quick-select slot; pickup refused'
        USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
    END IF;
  END IF;

  DELETE FROM world_eggs WHERE id = p_world_egg_id;

  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, v_region, 0, v_slot, v_item_id, 1)
  RETURNING * INTO v_row;

  PERFORM _log_item_history(
    v_user_id, 'pickup', v_item_id, v_item_key, 1,
    jsonb_build_object('kind', 'world_egg', 'egg_id', p_world_egg_id, 'tier', v_egg.tier),
    jsonb_build_object('region', v_region, 'page', 0, 'slot', v_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'rows', jsonb_build_array(row_to_json(v_row)),
    'deleted_row_ids', '[]'::jsonb,
    'deleted_world_egg_id', p_world_egg_id,
    'region', v_region,
    'slot', v_slot,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pickup_egg(UUID, UUID) TO authenticated;
