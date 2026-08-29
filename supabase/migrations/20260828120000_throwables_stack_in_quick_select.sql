-- Grenades stack in the QUICK BAR (and only there).
--
-- DreadRoot's standing rule is one unit per slot in inventory / quick_select /
-- equip; only the vault stacks. That rule stays intact everywhere except one
-- narrow case: a THROWABLE sitting in a quick_select slot, which is now the
-- game's "lethal" stock and reads as "Grenade x12" like every other shooter.
-- Inventory and equip are untouched — still strictly one unit per slot.
--
-- "Throwable" is decided by the item's CATEGORY (explosive) with a key-pattern
-- fallback for the legacy `grenade` item, which is still filed under 'weapon'.
-- Deliberately category-first so a new grenade added later just works without
-- another migration or another code change.

-- ── The single definition of "throwable" ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_throwable_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT lower(i.item_category) = 'explosive' OR i.key ILIKE '%grenade%'
       FROM items i WHERE i.id = p_item_id),
    FALSE
  );
$$;

-- ── Quantity rule: quick_select may stack a throwable, nothing else ───
CREATE OR REPLACE FUNCTION public.enforce_slot_quantity_by_region()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Inventory and equip are strictly one unit per slot, as before.
  IF NEW.region IN ('inventory', 'equip') AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_slots region=% rows must have quantity=1 (got %)', NEW.region, NEW.quantity
      USING ERRCODE = '23514';
  END IF;

  -- Quick bar: one unit per slot UNLESS the item is a throwable, which stacks.
  IF NEW.region = 'quick_select' AND NEW.quantity <> 1
     AND NOT public.is_throwable_item(NEW.item_id) THEN
    RAISE EXCEPTION
      'user_slots region=quick_select rows must have quantity=1 for non-throwables (got %)', NEW.quantity
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ── transfer_slot: let throwables move in quantity + merge in the bar ─
-- Only two rules change, both gated on the destination/source being a
-- throwable in quick_select:
--   * the "qty must be 1" guards no longer apply to a throwable
--   * a quick_select slot already holding the SAME throwable merges instead
--     of refusing with 23505
-- Every other path (inventory, vault, different item, insufficient quantity)
-- behaves exactly as it did.
CREATE OR REPLACE FUNCTION public.transfer_slot(
  p_from_region      TEXT,
  p_from_page        INTEGER,
  p_from_slot        INTEGER,
  p_to_region        TEXT,
  p_to_page          INTEGER,
  p_to_slot          INTEGER,
  p_quantity         INTEGER,
  p_client_request_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_src         RECORD;
  v_dst         RECORD;
  v_item_key    TEXT;
  v_same_slot   BOOLEAN;
  v_throwable   BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault')
     OR p_to_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- Slot bounds. Previously unchecked, so a caller that miscounted could file
  -- an item at inventory slot 0 or 40 — accepted by the table, never drawn by
  -- the grid, and therefore lost in plain sight. Refuse it instead.
  IF p_from_region = 'inventory'    AND (p_from_slot < 1 OR p_from_slot > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'inventory'    AND (p_to_slot   < 1 OR p_to_slot   > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_to_slot USING ERRCODE = '22023';
  END IF;
  IF p_from_region = 'quick_select' AND (p_from_slot < 1 OR p_from_slot > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'quick_select' AND (p_to_slot   < 1 OR p_to_slot   > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_to_slot USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  v_same_slot := (p_from_region = p_to_region
                  AND p_from_page = p_to_page
                  AND p_from_slot = p_to_slot);
  IF v_same_slot THEN
    RETURN json_build_object('replayed', false, 'noop', true);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|s|' || p_from_region || '|' || p_from_page::text || '|' || p_from_slot::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|s|' || p_to_region || '|' || p_to_page::text || '|' || p_to_slot::text, 0)
  );

  SELECT * INTO v_src FROM user_slots
   WHERE user_id = v_user_id AND region = p_from_region
     AND page = p_from_page AND slot = p_from_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source slot empty (% page=% slot=%)', p_from_region, p_from_page, p_from_slot
      USING ERRCODE = '23503';
  END IF;
  IF v_src.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity in source' USING ERRCODE = '23514';
  END IF;

  v_throwable := public.is_throwable_item(v_src.item_id);

  -- Inventory is still one unit per move, always.
  IF p_from_region = 'inventory' AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'inventory slots are qty=1' USING ERRCODE = '22023';
  END IF;
  IF p_to_region = 'inventory' AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'inventory destination requires qty=1' USING ERRCODE = '22023';
  END IF;
  -- Quick bar is one unit per move too, unless the item stacks there.
  IF p_from_region = 'quick_select' AND p_quantity <> 1 AND NOT v_throwable THEN
    RAISE EXCEPTION 'quick bar slots are qty=1' USING ERRCODE = '22023';
  END IF;
  IF p_to_region = 'quick_select' AND p_quantity <> 1 AND NOT v_throwable THEN
    RAISE EXCEPTION 'quick bar destination requires qty=1' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_dst FROM user_slots
   WHERE user_id = v_user_id AND region = p_to_region
     AND page = p_to_page AND slot = p_to_slot
   FOR UPDATE;

  IF FOUND THEN
    IF v_dst.item_id <> v_src.item_id THEN
      RAISE EXCEPTION 'Destination has a different item' USING ERRCODE = '23505';
    ELSIF p_to_region = 'inventory' THEN
      RAISE EXCEPTION 'Destination slot occupied (inventory does not stack)' USING ERRCODE = '23505';
    ELSIF p_to_region = 'quick_select' AND NOT v_throwable THEN
      RAISE EXCEPTION 'Destination slot occupied (quick bar does not stack)' USING ERRCODE = '23505';
    ELSE
      -- Vault merge, or a throwable merging into the quick bar.
      UPDATE user_slots SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = v_dst.id;
    END IF;
  ELSE
    INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
    VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_src.item_id, p_quantity);
  END IF;

  IF v_src.quantity = p_quantity THEN
    DELETE FROM user_slots WHERE id = v_src.id;
  ELSE
    UPDATE user_slots SET quantity = quantity - p_quantity, updated_at = NOW()
     WHERE id = v_src.id;
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_src.item_id;
  PERFORM _log_item_history(
    v_user_id, 'transfer', v_src.item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    jsonb_build_object('kind', p_to_region, 'page', p_to_page, 'slot', p_to_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'item_id', v_src.item_id,
    'quantity', p_quantity
  );
END;
$$;

-- ── equip_transfer: same slot-bounds guard ────────────────────────────
-- The equip panel's own "find me an empty inventory slot" scan counted from 0,
-- so an auto-evicted off-hand weapon would be filed at inventory slot 0, which
-- the grid never draws. The client scan is fixed; this refuses it server-side
-- too, so the next hand-rolled scan cannot lose an item either.
CREATE OR REPLACE FUNCTION public.equip_transfer(
  p_from_region      TEXT,
  p_from_page        INTEGER,
  p_from_slot        INTEGER,
  p_to_region        TEXT,
  p_to_page          INTEGER,
  p_to_slot          INTEGER,
  p_client_request_id UUID
)
RETURNS JSON
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
  IF p_from_region NOT IN ('inventory','quick_select','vault','equip')
     OR p_to_region NOT IN ('inventory','quick_select','vault','equip') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_from_region <> 'equip' AND p_to_region <> 'equip' THEN
    RAISE EXCEPTION 'equip_transfer requires an equip side' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  IF p_from_region = 'inventory'    AND (p_from_slot < 1 OR p_from_slot > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'inventory'    AND (p_to_slot   < 1 OR p_to_slot   > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_to_slot USING ERRCODE = '22023';
  END IF;
  IF p_from_region = 'quick_select' AND (p_from_slot < 1 OR p_from_slot > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'quick_select' AND (p_to_slot   < 1 OR p_to_slot   > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_to_slot USING ERRCODE = '22023';
  END IF;
  IF p_from_region = 'equip'        AND (p_from_slot < 1 OR p_from_slot > 5) THEN
    RAISE EXCEPTION 'equip slot % out of range 1-5', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'equip'        AND (p_to_slot   < 1 OR p_to_slot   > 5) THEN
    RAISE EXCEPTION 'equip slot % out of range 1-5', p_to_slot USING ERRCODE = '22023';
  END IF;

  IF p_from_region = p_to_region AND p_from_page = p_to_page AND p_from_slot = p_to_slot THEN
    RETURN json_build_object('replayed', false, 'noop', true);
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|equip_xfer', 0));

  SELECT * INTO v_from FROM user_slots
   WHERE user_id = v_user_id AND region = p_from_region AND page = p_from_page AND slot = p_from_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503'; END IF;
  IF v_from.quantity <> 1 THEN RAISE EXCEPTION 'equip_transfer only moves single units' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_to FROM user_slots
   WHERE user_id = v_user_id AND region = p_to_region AND page = p_to_page AND slot = p_to_slot FOR UPDATE;

  IF v_to.id IS NULL THEN
    DELETE FROM user_slots WHERE id = v_from.id;
    INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
    VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_from.item_id, 1);
    RETURN json_build_object('replayed', false, 'moved', true);
  END IF;

  -- Swap. The destination's stack (a vault pile, or a quick-bar throwable
  -- stack) goes back to the source slot whole; the trigger refuses it if that
  -- slot cannot legally hold a stack, which aborts the whole transaction
  -- rather than shedding units.
  DELETE FROM user_slots WHERE id = v_from.id;
  DELETE FROM user_slots WHERE id = v_to.id;
  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_from.item_id, 1);
  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, p_from_region, p_from_page, p_from_slot, v_to.item_id, v_to.quantity);
  RETURN json_build_object('replayed', false, 'swapped', true);
END;
$$;

-- ── swap_slot: same slot-bounds guard ─────────────────────────────────
-- Body is unchanged; it already carries the destination's quantity across
-- intact and lets the region trigger re-validate each row where it lands, so a
-- throwable stack swapping between two quick-bar slots just works.
CREATE OR REPLACE FUNCTION public.swap_slot(
  p_from_region      TEXT,
  p_from_page        INTEGER,
  p_from_slot        INTEGER,
  p_to_region        TEXT,
  p_to_page          INTEGER,
  p_to_slot          INTEGER,
  p_client_request_id UUID
)
RETURNS JSON
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
  IF p_from_region = 'inventory'    AND (p_from_slot < 1 OR p_from_slot > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'inventory'    AND (p_to_slot   < 1 OR p_to_slot   > 18) THEN
    RAISE EXCEPTION 'inventory slot % out of range 1-18', p_to_slot USING ERRCODE = '22023';
  END IF;
  IF p_from_region = 'quick_select' AND (p_from_slot < 1 OR p_from_slot > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_from_slot USING ERRCODE = '22023';
  END IF;
  IF p_to_region   = 'quick_select' AND (p_to_slot   < 1 OR p_to_slot   > 6) THEN
    RAISE EXCEPTION 'quick bar slot % out of range 1-6', p_to_slot USING ERRCODE = '22023';
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

-- ── Retire the dead consume path ──────────────────────────────────────
-- consume_quick_slot still read user_equipped_items, a table that has held
-- zero rows since the move to user_slots, so every call would have failed.
-- Nothing calls it any more (the client routes through consume_slot). Drop it
-- before something wires it back up.
DROP FUNCTION IF EXISTS public.consume_quick_slot(INTEGER, UUID);

GRANT EXECUTE ON FUNCTION public.is_throwable_item(UUID) TO authenticated;

-- ── The catalogue, served from the same definition ────────────────────
-- The client used to carry its own copy of the "which items are grenades"
-- filter, which is how it and the database came to disagree. Reading the
-- catalogue through this function means there is exactly one rule, and a
-- future grenade cannot be throwable to one side and invisible to the other.
CREATE OR REPLACE FUNCTION public.list_throwable_items()
RETURNS TABLE (
  id           UUID,
  key          TEXT,
  name         TEXT,
  kind         TEXT,
  tier         INTEGER,
  item_number  INTEGER,
  texture_url  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id,
         i.key,
         i.name,
         CASE WHEN i.key ILIKE 'shpider_egg%' THEN 'egg' ELSE 'grenade' END AS kind,
         COALESCE(i.tier, 1),
         i.item_number,
         i.texture_url
    FROM items i
   WHERE public.is_throwable_item(i.id)
      OR i.key ILIKE 'shpider_egg%';
$$;

GRANT EXECUTE ON FUNCTION public.list_throwable_items() TO authenticated, anon;
