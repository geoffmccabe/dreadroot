-- Quick Select (QS) becomes a STORAGE LOCATION, not a reference. An
-- item in QS lives ONLY in QS — it is no longer in user_inventory.
-- The user_equipped_items table keeps its schema (user_id, slot_type,
-- item_id) but its semantics flip:
--
--   OLD: row says "this slot is bound to itemId X" (a pointer; the
--        actual item lives in user_inventory)
--   NEW: row says "this slot HOLDS the item itemId X" (storage; the
--        inv row of itemId X has been deleted on equip)
--
-- Three changes here:
--
-- 1. Data cleanup: for each existing user_equipped_items row, claim
--    one matching inv row and delete it. After this runs, no item
--    coexists in inv and QS.
--
-- 2. Four new transfer RPCs (atomic, replay-protected, item_history-
--    audited):
--      transfer_inv_to_qs   — MOVE one inv row → QS slot
--      transfer_qs_to_inv   — MOVE one QS slot → new inv row
--      transfer_qs_to_vault — MOVE one QS slot → vault slot (stacks)
--      transfer_vault_to_qs — MOVE one unit out of vault → QS slot
--    Plus consume_quick_slot for when a QS item is used up
--    (grenade thrown, potion drunk).
--
-- 3. user_equipped_items.slot_type is treated as a stringified
--    integer (e.g. '0' through '9'). The existing schema uses TEXT
--    for slot_type; we cast where needed. No schema change required.

-- ────────────────────────────────────────────────────────────────────
-- 1. Data cleanup. For each user_equipped_items row, delete one
-- matching inv row. Older inv rows claimed first.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_claimed INTEGER := 0;
BEGIN
  FOR equipped IN
    SELECT user_id, slot_type, item_id FROM user_equipped_items
  LOOP
    DELETE FROM user_inventory
     WHERE id = (
       SELECT id FROM user_inventory
        WHERE user_id = equipped.user_id
          AND item_type = 'item'
          AND item_id = equipped.item_id
        ORDER BY created_at ASC
        LIMIT 1
     );
    IF FOUND THEN v_claimed := v_claimed + 1; END IF;
  END LOOP;
  RAISE NOTICE 'QS claim: deleted % inv rows that were also in user_equipped_items', v_claimed;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 2a. transfer_inv_to_qs — MOVE one inv row to a QS slot.
-- Atomic: deletes the inv row + inserts/replaces the QS slot in one txn.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_inv_to_qs(
  p_inventory_row_id  UUID,
  p_qs_slot           INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_inv_row    RECORD;
  v_existing   RECORD;
  v_item_key   TEXT;
  v_old_qs     RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_inventory_row_id IS NULL THEN
    RAISE EXCEPTION 'inventory_row_id required' USING ERRCODE = '22023';
  END IF;
  IF p_qs_slot IS NULL OR p_qs_slot < 0 OR p_qs_slot > 9 THEN
    RAISE EXCEPTION 'Invalid qs_slot %', p_qs_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  -- Lock + verify inv row.
  SELECT * INTO v_inv_row FROM user_inventory
   WHERE id = p_inventory_row_id AND user_id = v_user_id AND item_type = 'item'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory row % not found or not owned', p_inventory_row_id USING ERRCODE = '23503';
  END IF;
  IF v_inv_row.item_id IS NULL THEN
    RAISE EXCEPTION 'Inventory row is not a regular item' USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_inv_row.item_id;

  -- If the QS slot already has an item, kick it back to inv (single
  -- transaction; conserves all units).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|qs|' || 'hotbar_' || p_qs_slot::text, 0)
  );
  SELECT * INTO v_old_qs FROM user_equipped_items
   WHERE user_id = v_user_id AND slot_type = 'hotbar_' || p_qs_slot::text
   FOR UPDATE;
  IF FOUND THEN
    -- Move displaced item back to inv as a new qty=1 row.
    INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user_id, 'item', v_old_qs.item_id, 1);
    DELETE FROM user_equipped_items WHERE id = v_old_qs.id;
  END IF;

  -- Move the dragged inv row into the QS slot.
  INSERT INTO user_equipped_items (user_id, slot_type, item_id)
  VALUES (v_user_id, 'hotbar_' || p_qs_slot::text, v_inv_row.item_id);

  DELETE FROM user_inventory WHERE id = p_inventory_row_id;

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_inv_row.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'inventory', 'row_id', p_inventory_row_id),
    jsonb_build_object('kind', 'quick_slot', 'slot', p_qs_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'qs_slot', p_qs_slot, 'item_id', v_inv_row.item_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_inv_to_qs(UUID, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2b. transfer_qs_to_inv — MOVE a QS slot's item back to inv.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_qs_to_inv(
  p_qs_slot           INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_qs_row     RECORD;
  v_item_key   TEXT;
  v_new_inv    RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_qs_slot IS NULL OR p_qs_slot < 0 OR p_qs_slot > 9 THEN
    RAISE EXCEPTION 'Invalid qs_slot %', p_qs_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|qs|' || 'hotbar_' || p_qs_slot::text, 0)
  );
  SELECT * INTO v_qs_row FROM user_equipped_items
   WHERE user_id = v_user_id AND slot_type = 'hotbar_' || p_qs_slot::text
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QS slot % empty', p_qs_slot USING ERRCODE = '23503';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_qs_row.item_id;

  INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
  VALUES (v_user_id, 'item', v_qs_row.item_id, 1) RETURNING * INTO v_new_inv;

  DELETE FROM user_equipped_items WHERE id = v_qs_row.id;

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_qs_row.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'quick_slot', 'slot', p_qs_slot),
    jsonb_build_object('kind', 'inventory', 'row_id', v_new_inv.id),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'inventory_row_id', v_new_inv.id, 'item_id', v_qs_row.item_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_qs_to_inv(INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2c. transfer_qs_to_vault — MOVE a QS slot's item into a vault slot.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_qs_to_vault(
  p_qs_slot           INTEGER,
  p_vault_page        INTEGER,
  p_vault_slot        INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_qs_row     RECORD;
  v_item_key   TEXT;
  v_existing   RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_qs_slot IS NULL OR p_qs_slot < 0 OR p_qs_slot > 9 THEN
    RAISE EXCEPTION 'Invalid qs_slot %', p_qs_slot USING ERRCODE = '22023';
  END IF;
  IF p_vault_page IS NULL OR p_vault_page < 0 OR p_vault_page > 31 THEN
    RAISE EXCEPTION 'Invalid vault page' USING ERRCODE = '22023';
  END IF;
  IF p_vault_slot IS NULL OR p_vault_slot < 0 OR p_vault_slot > 255 THEN
    RAISE EXCEPTION 'Invalid vault slot' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|qs|' || 'hotbar_' || p_qs_slot::text, 0));
  SELECT * INTO v_qs_row FROM user_equipped_items
   WHERE user_id = v_user_id AND slot_type = 'hotbar_' || p_qs_slot::text
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QS slot % empty', p_qs_slot USING ERRCODE = '23503'; END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_qs_row.item_id;

  -- Lock target vault slot.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_vault_page::text || '|' || p_vault_slot::text, 0)
  );
  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_vault_page AND slot = p_vault_slot FOR UPDATE;

  IF FOUND AND v_existing.item_id = v_qs_row.item_id THEN
    UPDATE user_vault SET quantity = quantity + 1 WHERE id = v_existing.id;
  ELSIF FOUND THEN
    RAISE EXCEPTION 'Target vault slot occupied by a different item' USING ERRCODE = '23505';
  ELSE
    INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
    VALUES (v_user_id, p_vault_page, p_vault_slot, v_qs_row.item_id, 1);
  END IF;

  DELETE FROM user_equipped_items WHERE id = v_qs_row.id;

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_qs_row.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'quick_slot', 'slot', p_qs_slot),
    jsonb_build_object('kind', 'vault', 'page', p_vault_page, 'slot', p_vault_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_qs_to_vault(INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2d. transfer_vault_to_qs — MOVE one unit out of a vault slot into a QS slot.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_vault_to_qs(
  p_vault_page        INTEGER,
  p_vault_slot        INTEGER,
  p_qs_slot           INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_vault_row  RECORD;
  v_old_qs     RECORD;
  v_item_key   TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_qs_slot IS NULL OR p_qs_slot < 0 OR p_qs_slot > 9 THEN
    RAISE EXCEPTION 'Invalid qs_slot %', p_qs_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  SELECT * INTO v_vault_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_vault_page AND slot = p_vault_slot
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vault slot empty' USING ERRCODE = '23503'; END IF;
  IF v_vault_row.quantity < 1 THEN RAISE EXCEPTION 'Vault slot is empty' USING ERRCODE = '23514'; END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_vault_row.item_id;

  -- Lock + handle replacement at target QS slot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|qs|' || 'hotbar_' || p_qs_slot::text, 0));
  SELECT * INTO v_old_qs FROM user_equipped_items
   WHERE user_id = v_user_id AND slot_type = 'hotbar_' || p_qs_slot::text FOR UPDATE;
  IF FOUND THEN
    INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user_id, 'item', v_old_qs.item_id, 1);
    DELETE FROM user_equipped_items WHERE id = v_old_qs.id;
  END IF;

  -- Decrement / delete vault row.
  IF v_vault_row.quantity = 1 THEN
    DELETE FROM user_vault WHERE id = v_vault_row.id;
  ELSE
    UPDATE user_vault SET quantity = quantity - 1 WHERE id = v_vault_row.id;
  END IF;

  INSERT INTO user_equipped_items (user_id, slot_type, item_id)
  VALUES (v_user_id, 'hotbar_' || p_qs_slot::text, v_vault_row.item_id);

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_vault_row.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'vault', 'page', p_vault_page, 'slot', p_vault_slot),
    jsonb_build_object('kind', 'quick_slot', 'slot', p_qs_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_vault_to_qs(INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2e. consume_quick_slot — DELETE a QS row (item used up: grenade
-- thrown, potion drunk). Distinct from transfer_* because the item
-- is destroyed, not moved.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_quick_slot(
  p_qs_slot           INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_qs_row     RECORD;
  v_item_key   TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_qs_slot IS NULL OR p_qs_slot < 0 OR p_qs_slot > 9 THEN
    RAISE EXCEPTION 'Invalid qs_slot %', p_qs_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  SELECT * INTO v_qs_row FROM user_equipped_items
   WHERE user_id = v_user_id AND slot_type = 'hotbar_' || p_qs_slot::text FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QS slot % empty', p_qs_slot USING ERRCODE = '23503';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_qs_row.item_id;

  DELETE FROM user_equipped_items WHERE id = v_qs_row.id;

  PERFORM _log_item_history(
    v_user_id, 'consume', v_qs_row.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'quick_slot', 'slot', p_qs_slot),
    NULL, p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_quick_slot(INTEGER, UUID) TO authenticated;
