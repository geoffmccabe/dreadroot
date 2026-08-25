-- Picked-up Shpider eggs were invisible.
--
-- pickup_egg wrote into user_inventory, the LEGACY table, as
-- item_type='item' with an item_id. The inventory grid reads items from
-- user_slots and only takes BLOCKS AND SEEDS from the legacy table:
--
--     .filter(r => r.item_type !== 'item' || r.item_id === null)
--
-- so an egg landed on the exactly-wrong side of that test. The row was created,
-- the egg was charged and removed from the world, and the player got nothing
-- they could see. Confirmed against live data: the egg picked up at 01:47 on
-- 2026-Aug-25 is sitting in user_inventory right now.
--
-- This function was simply never updated when items moved to user_slots. Body
-- reproduced from the deployed function and patched programmatically, not
-- retyped -- hand-copying grant_slot silently dropped three behaviours last
-- time.
--
-- Also fixed while here: the egg was DELETED from the world before anything
-- checked there was room for it, so picking one up with a full bag destroyed
-- it. Now the slot is claimed first and the pickup refuses cleanly instead.

CREATE OR REPLACE FUNCTION public.pickup_egg(p_world_egg_id uuid, p_client_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
  DECLARE
    v_user_id UUID := auth.uid();
    v_is_new BOOLEAN; v_egg RECORD; v_item_id UUID;
    v_cooldown_secs INTEGER; v_cooldown_until TIMESTAMPTZ; v_rows JSONB;
    v_slot INTEGER; v_region TEXT;
  BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
    IF p_world_egg_id IS NULL THEN RAISE EXCEPTION 'world_egg_id required' USING ERRCODE = '22023'; END IF;
    IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023'; END
  IF;

    v_is_new := check_and_record_request(p_client_request_id, v_user_id);
    IF NOT v_is_new THEN
      RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
    END IF;

    SELECT * INTO v_egg FROM world_eggs WHERE id = p_world_egg_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'World egg % not found', p_world_egg_id USING ERRCODE = '23503'; END IF;
    IF v_egg.owner_user_id IS NOT NULL AND v_egg.owner_user_id <> v_user_id THEN
      RAISE EXCEPTION 'Egg belongs to another user' USING ERRCODE = '42501';
    END IF;
  
    v_item_id := v_egg.item_id;
    IF v_item_id IS NULL THEN 
      SELECT id INTO v_item_id FROM items WHERE key = 'shpider_egg_t' || v_egg.tier::text;
      IF v_item_id IS NULL THEN RAISE EXCEPTION 'Item lookup failed for egg %', v_egg.id USING ERRCODE = '23503';
  END IF;
    END IF;
  
    SELECT pickup_cooldown_seconds INTO v_cooldown_secs FROM items WHERE id = v_item_id;
    IF v_cooldown_secs IS NOT NULL AND v_cooldown_secs > 0 THEN 
      v_cooldown_until := NOW() + make_interval(secs => v_cooldown_secs);
    ELSE
      v_cooldown_until := NULL;
    END IF; 

    -- Into user_slots, which is where the inventory grid actually reads from.
    -- Items never stack, so each egg needs its own slot; fall through to
    -- quick-select if the bag is full, exactly as world-drop pickup does.
    v_slot := public._first_empty_slot(v_user_id, 'inventory', 0);
    v_region := 'inventory';
    IF v_slot IS NULL THEN
      v_slot := public._first_empty_slot(v_user_id, 'quick_select', 0);
      v_region := 'quick_select';
      IF v_slot IS NULL THEN
        RAISE EXCEPTION 'No empty inventory or quick-select slot; egg left in the world'
          USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
      END IF;
    END IF;

    DELETE FROM world_eggs WHERE id = p_world_egg_id;

    WITH inserted AS (
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (v_user_id, v_region, 0, v_slot, v_item_id, 1) RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

    RETURN json_build_object('rows', v_rows, 'deleted_row_ids', '[]'::jsonb,
                             'deleted_world_egg_id', p_world_egg_id, 'replayed', false);
  END;
  $fn$;

REVOKE ALL ON FUNCTION public.pickup_egg(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_egg(UUID, UUID) TO authenticated;
