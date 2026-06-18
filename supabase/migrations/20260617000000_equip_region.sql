-- Adds an 'equip' region to the unified user_slots system so the 4 equip slots
-- (weapon/armor/boots/potion) are REAL slots — equipping MOVES the item out of
-- inventory/QS (it can't be in two places at once).
--
-- Deliberately ISOLATED: it does NOT touch transfer_slot / swap_slot (the functions
-- that power inventory↔QS↔vault). Equip moves go through a fresh equip_transfer RPC.
-- The move is done as DELETE-source + INSERT-dest so the existing user_slots realtime
-- subscription (which handles inventory/quick_select DELETE) clears the source side.

-- 1. Allow the 'equip' region.
ALTER TABLE public.user_slots DROP CONSTRAINT IF EXISTS user_slots_region_check;
ALTER TABLE public.user_slots ADD CONSTRAINT user_slots_region_check
  CHECK (region IN ('inventory', 'quick_select', 'vault', 'equip'));

-- 2. equip rows are single units (quantity = 1), like inventory/quick_select.
CREATE OR REPLACE FUNCTION public.enforce_slot_quantity_by_region()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.region IN ('inventory', 'quick_select', 'equip') AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_slots region=% rows must have quantity=1 (got %)', NEW.region, NEW.quantity
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. equip_transfer — move (or swap) a single item between the equip region and
--    another region. Exactly one side must be 'equip'.
CREATE OR REPLACE FUNCTION public.equip_transfer(
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
  v_user_id UUID := auth.uid();
  v_is_new  BOOLEAN;
  v_from    RECORD;
  v_to      RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault', 'equip')
     OR p_to_region NOT IN ('inventory', 'quick_select', 'vault', 'equip') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_from_region <> 'equip' AND p_to_region <> 'equip' THEN
    RAISE EXCEPTION 'equip_transfer requires an equip side' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;
  IF p_from_region = p_to_region AND p_from_page = p_to_page AND p_from_slot = p_to_slot THEN
    RETURN json_build_object('replayed', false, 'noop', true);
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|equip_xfer', 0));

  SELECT * INTO v_from FROM user_slots
   WHERE user_id = v_user_id AND region = p_from_region AND page = p_from_page AND slot = p_from_slot
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503'; END IF;
  IF v_from.quantity <> 1 THEN
    RAISE EXCEPTION 'equip_transfer only moves single units' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_to FROM user_slots
   WHERE user_id = v_user_id AND region = p_to_region AND page = p_to_page AND slot = p_to_slot
   FOR UPDATE;

  IF v_to.id IS NULL THEN
    -- Move: delete source, insert at dest. (DELETE drives the source realtime cleanup.)
    DELETE FROM user_slots WHERE id = v_from.id;
    INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
    VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_from.item_id, 1);
    RETURN json_build_object('replayed', false, 'moved', true);
  END IF;

  -- Swap: delete both, reinsert each at the other's location.
  DELETE FROM user_slots WHERE id = v_from.id;
  DELETE FROM user_slots WHERE id = v_to.id;
  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_from.item_id, 1);
  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, p_from_region, p_from_page, p_from_slot, v_to.item_id, v_to.quantity);
  RETURN json_build_object('replayed', false, 'swapped', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.equip_transfer(TEXT, INTEGER, INTEGER, TEXT, INTEGER, INTEGER, UUID) TO authenticated;
