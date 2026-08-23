-- Close the free-items hole: any logged-in player could hand themselves ANY
-- item, up to 100 at a time, at no cost.
--
-- grant_slot is SECURITY DEFINER and was executable by PUBLIC. It takes an
-- item id chosen by the CLIENT and inserts it straight into that player's
-- slots -- no purchase, no drop roll, no ownership check anywhere in the path.
-- So "grant me my starter items" and "grant me a hundred of the best weapon in
-- the game" were the same call. Free, unlimited guest accounts make it worse,
-- because another attempt costs nothing.
--
-- The body below is the DEPLOYED function, reproduced byte for byte with only
-- the admin guard inserted. It was NOT retyped: hand-copying it lost vault
-- stacking, the item_history audit write and the out-of-space refusal on the
-- first attempt, any of which would have been a silent data bug.
--
-- WHAT STILL WORKS, deliberately -- this restricts ITEM grants only:
--   wisp block pickup    grant_inventory_row with a block key
--   seed return          grant_inventory_row with seed_tier_N
--   world drop pickup    pickup_world_drop inserts directly, untouched
--   starter loadout      grant_starter_loadout inserts directly, untouched
--   vault -> inventory   the atomic transfer_vault_to_inventory RPC
-- None of those let the client name an arbitrary weapon. Blocks and seeds are
-- still client-trusted and worth hardening later, but they are not this hole.
--
-- WHAT CHANGES, and why it is correct:
--   Ctrl-G / Ctrl-H in-game grant -- an ADMIN tool that was never enforced as
--     one server-side. Now it is.
--   Admin panel "grant item" -- still works, for admins.
--   The legacy vault->inventory FALLBACK used when the atomic transfer failed.
--     On refusal the item stays in the vault, which is the safe outcome; that
--     fallback's own comments warn it can duplicate.

CREATE OR REPLACE FUNCTION public._can_grant_items(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $can$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = p_user_id
       AND role IN ('admin', 'superadmin')
  );
$can$;

CREATE OR REPLACE FUNCTION public.grant_slot(p_region text, p_item_id uuid, p_quantity integer, p_client_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_item_key  TEXT;
  v_remaining INTEGER;
  v_inserted  INTEGER := 0;
  v_slot      INTEGER;
  v_existing  RECORD;
  v_overflow  BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;

  -- THE FIX. Naming your own item is an administrative act, not a player one.
  -- Everything that hands out a client-chosen item flows through here,
  -- including grant_inventory_row's 'item' branch, so this one check covers
  -- the whole surface instead of each entry point having to remember.
  IF NOT public._can_grant_items(v_user_id) THEN
    RAISE EXCEPTION 'Item grants are restricted to administrators'
      USING ERRCODE = '42501';
  END IF;
  IF p_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true, 'granted', 0, 'overflow_to_qs', false);
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_remaining := p_quantity;

  IF p_region IN ('inventory', 'quick_select') THEN
    -- Each unit gets its own slot. Try the requested region first.
    WHILE v_remaining > 0 LOOP
      v_slot := public._first_empty_slot(v_user_id, p_region, 0);
      IF v_slot IS NULL THEN EXIT; END IF;
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (v_user_id, p_region, 0, v_slot, p_item_id, 1);
      v_inserted := v_inserted + 1;
      v_remaining := v_remaining - 1;
    END LOOP;

    -- Overflow from inventory → QS if inventory filled but QS has space.
    -- (The reverse — QS overflowing to inventory — is not requested.)
    IF v_remaining > 0 AND p_region = 'inventory' THEN
      WHILE v_remaining > 0 LOOP
        v_slot := public._first_empty_slot(v_user_id, 'quick_select', 0);
        IF v_slot IS NULL THEN EXIT; END IF;
        INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
        VALUES (v_user_id, 'quick_select', 0, v_slot, p_item_id, 1);
        v_inserted := v_inserted + 1;
        v_remaining := v_remaining - 1;
        v_overflow := true;
      END LOOP;
    END IF;
  ELSE
    -- Vault: try to stack on existing same-item slot, else first empty.
    SELECT * INTO v_existing FROM user_slots
     WHERE user_id = v_user_id AND region = 'vault' AND item_id = p_item_id
     ORDER BY page, slot LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE user_slots SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = v_existing.id;
      v_inserted := p_quantity;
      v_remaining := 0;
    ELSE
      v_slot := public._first_empty_slot(v_user_id, 'vault', 0);
      IF v_slot IS NOT NULL THEN
        INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
        VALUES (v_user_id, 'vault', 0, v_slot, p_item_id, p_quantity);
        v_inserted := p_quantity;
        v_remaining := 0;
      END IF;
    END IF;
  END IF;

  -- If anything was inserted, audit it.
  IF v_inserted > 0 THEN
    PERFORM _log_item_history(
      v_user_id, 'grant', p_item_id, v_item_key, v_inserted,
      NULL,
      jsonb_build_object('kind', p_region, 'overflow_to_qs', v_overflow),
      p_client_request_id, NULL
    );
  END IF;

  -- If NOTHING could be inserted (all regions full), REFUSE so the
  -- caller can show a "no space" message instead of silently dropping
  -- the item.
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'No empty slots in % (and QS overflow region also full); item refused', p_region
      USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
  END IF;

  RETURN json_build_object(
    'replayed', false,
    'granted', v_inserted,
    'refused', v_remaining,
    'overflow_to_qs', v_overflow
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.grant_slot(TEXT, UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_slot(TEXT, UUID, INTEGER, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.grant_inventory_row(TEXT, UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_inventory_row(TEXT, UUID, INTEGER, UUID) TO authenticated;
