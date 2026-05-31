-- Hotfix migration. Fixes the bugs surfaced by the 2026-05-31 audit.
--
-- Items addressed (severity in [brackets]):
--   1. [CRIT] transfer_inventory_to_vault: `v_deleted` is JSONB but a
--      BIGINT (COUNT) was being assigned into it → runtime cast error.
--      Removed the count, simplified the verification.
--   2. [CRIT] transfer_vault_to_inventory + transfer_inventory_to_vault:
--      flame_glove + pistol were in the SQL non-stackable list but in
--      no other (TS) list. TS is canonical; removed them here so the
--      client and server agree on stack behavior.
--   3. [HIGH] vault_set_slot: replace branch silently destroyed an
--      existing different-item stack at the slot. Now refuses
--      (23505) — caller must move the displaced stack first.
--   4. [HIGH] vault_set_slot, vault_remove_from_slot,
--      consume_inventory_target, grant_inventory_row stackable branch:
--      missing FOR UPDATE / advisory locks → concurrent calls could
--      lose or dupe rows. Added.
--   5. [HIGH] transfer_vault_to_vault: `FOUND` was reused after an
--      intervening DELETE/UPDATE on the source row, so the dst-merge
--      branch decision was checking the wrong thing. Fixed.
--   6. [MED] All three transfer RPCs returned the wrong shape on
--      replay (just {replayed, rows}) → client adapter saw undefined
--      vault_row/inventory_rows. Now replay re-reads and returns the
--      actual post-state.
--   7. [MED] _log_item_history: REVOKE only covered `authenticated`,
--      not PUBLIC/anon. Tightened.

-- ───────────────────────────────────────────────────────────────────
-- 7. Tighten _log_item_history grants.
-- ───────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public._log_item_history(
  UUID, TEXT, UUID, TEXT, INTEGER, JSONB, JSONB, UUID, JSONB
) FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────
-- 1+2+6. transfer_inventory_to_vault (CRITICAL fix)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_inventory_to_vault(
  p_inventory_row_ids UUID[],
  p_target_page       INTEGER,
  p_target_slot       INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_item_id     UUID;
  v_item_key    TEXT;
  v_total_qty   INTEGER := 0;
  v_locked_cnt  INTEGER := 0;
  v_existing    RECORD;
  v_vault_row   JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_inventory_row_ids IS NULL OR array_length(p_inventory_row_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'inventory_row_ids required' USING ERRCODE = '22023';
  END IF;
  IF p_target_page IS NULL OR p_target_page < 0 OR p_target_page > 31 THEN
    RAISE EXCEPTION 'Invalid page %', p_target_page USING ERRCODE = '22023';
  END IF;
  IF p_target_slot IS NULL OR p_target_slot < 0 OR p_target_slot > 255 THEN
    RAISE EXCEPTION 'Invalid slot %', p_target_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    -- Replay: return current state of the target slot.
    SELECT jsonb_agg(row_to_json(v.*)) INTO v_vault_row FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_target_page AND v.slot = p_target_slot;
    RETURN json_build_object(
      'replayed', true,
      'vault_row', COALESCE(v_vault_row, '[]'::jsonb),
      'removed_inventory_row_ids', '[]'::jsonb,
      'item_id', NULL,
      'quantity', 0);
  END IF;

  -- Lock the inventory rows + sum qty + verify single-itemId in ONE query.
  -- bool_and inside the CTE avoids the prior 2-pass design.
  WITH locked AS (
    SELECT id, item_id, quantity
      FROM user_inventory
     WHERE id = ANY(p_inventory_row_ids)
       AND user_id = v_user_id
       AND item_type = 'item'
       AND item_id IS NOT NULL
       FOR UPDATE
  ),
  agg AS (
    SELECT
      MIN(item_id) AS item_id,
      bool_and(item_id = (SELECT MIN(item_id) FROM locked)) AS all_same,
      SUM(quantity)::INTEGER AS total_qty,
      COUNT(*)::INTEGER AS locked_cnt
    FROM locked
  )
  SELECT item_id, total_qty, locked_cnt INTO v_item_id, v_total_qty, v_locked_cnt
    FROM agg WHERE all_same;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'No matching inventory rows or mixed item_ids' USING ERRCODE = '23503';
  END IF;
  IF v_locked_cnt <> array_length(p_inventory_row_ids, 1) THEN
    RAISE EXCEPTION 'Some inventory_row_ids not found / not owned' USING ERRCODE = '23503';
  END IF;
  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total quantity is zero' USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;

  -- Lock target slot. Same advisory-hash shape as elsewhere.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_target_page::text || '|' || p_target_slot::text, 0)
  );
  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_target_page AND slot = p_target_slot
   FOR UPDATE;

  IF FOUND AND v_existing.item_id = v_item_id THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + v_total_qty
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_vault_row FROM updated;
  ELSIF FOUND THEN
    RAISE EXCEPTION 'Target vault slot occupied by a different item' USING ERRCODE = '23505';
  ELSE
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_target_page, p_target_slot, v_item_id, v_total_qty)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_vault_row FROM inserted;
  END IF;

  DELETE FROM user_inventory
   WHERE id = ANY(p_inventory_row_ids) AND user_id = v_user_id;

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_item_id, v_item_key, v_total_qty,
    jsonb_build_object('kind', 'inventory', 'row_ids', to_jsonb(p_inventory_row_ids)),
    jsonb_build_object('kind', 'vault', 'page', p_target_page, 'slot', p_target_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'vault_row', v_vault_row,
    'removed_inventory_row_ids', to_jsonb(p_inventory_row_ids),
    'item_id', v_item_id,
    'quantity', v_total_qty
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 2+6. transfer_vault_to_inventory (drop flame_glove/pistol; fix replay)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_vault_to_inventory(
  p_source_page       INTEGER,
  p_source_slot       INTEGER,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_vault_row      RECORD;
  v_item_id        UUID;
  v_item_key       TEXT;
  v_non_stackable  BOOLEAN := false;
  v_inv_rows       JSONB;
  v_remaining      INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    -- Replay: just return current state at the source vault slot.
    SELECT row_to_json(v) INTO v_inv_rows FROM (
      SELECT quantity FROM user_vault
       WHERE user_id = v_user_id AND page = p_source_page AND slot = p_source_slot
    ) v;
    RETURN json_build_object('replayed', true,
      'inventory_rows', '[]'::jsonb,
      'vault_remaining', COALESCE((v_inv_rows->>'quantity')::INTEGER, 0),
      'item_id', NULL, 'quantity', 0);
  END IF;

  SELECT * INTO v_vault_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_source_page AND slot = p_source_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source vault slot empty' USING ERRCODE = '23503';
  END IF;
  IF v_vault_row.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_vault_row.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  v_item_id := v_vault_row.item_id;
  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Source item % not found in items table', v_item_id USING ERRCODE = '23503';
  END IF;

  -- Canonical non-stackable list. MUST mirror FortressHUD's
  -- isNonStackableKey and useUserData.isNonStackableKey.
  -- flame_glove and pistol DO stack — they were here by mistake.
  v_non_stackable :=
        v_item_key = 'health_potion'
     OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
     OR v_item_key = 'diamond'
     OR v_item_key LIKE 'shpider_egg_t%';

  IF v_vault_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_vault_row.id;
    v_remaining := 0;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity
     WHERE id = v_vault_row.id
     RETURNING quantity INTO v_remaining;
  END IF;

  IF v_non_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, 'item', v_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_user_id::text || '|item|' || v_item_id::text, 0)
    );
    WITH updated AS (
      UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id AND item_type = 'item' AND item_id = v_item_id
          ORDER BY created_at ASC LIMIT 1
          FOR UPDATE
       ) RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_inv_rows FROM updated;
    IF v_inv_rows IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, 'item', v_item_id, p_quantity)
        RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;
    END IF;
  END IF;

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', 'vault', 'page', p_source_page, 'slot', p_source_slot),
    jsonb_build_object('kind', 'inventory'),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'inventory_rows', v_inv_rows,
    'vault_remaining', v_remaining,
    'item_id', v_item_id,
    'quantity', p_quantity
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 5+6. transfer_vault_to_vault (fix FOUND-reuse bug + replay shape)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_vault_to_vault(
  p_src_page          INTEGER,
  p_src_slot          INTEGER,
  p_dst_page          INTEGER,
  p_dst_slot          INTEGER,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_is_new       BOOLEAN;
  v_src_row      RECORD;
  v_dst_row      RECORD;
  v_dst_existed  BOOLEAN;
  v_item_id      UUID;
  v_item_key     TEXT;
  v_dst_jsonb    JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;
  IF p_src_page = p_dst_page AND p_src_slot = p_dst_slot THEN
    RAISE EXCEPTION 'Source and destination must differ' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(v.*)) INTO v_dst_jsonb FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_dst_page AND v.slot = p_dst_slot;
    RETURN json_build_object('replayed', true,
      'destination_row', COALESCE(v_dst_jsonb, '[]'::jsonb),
      'item_id', NULL, 'quantity', 0);
  END IF;

  -- Lock src + dst slots with advisory + row locks.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_src_page::text || '|' || p_src_slot::text, 0)
  );
  SELECT * INTO v_src_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_src_page AND slot = p_src_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503'; END IF;
  IF v_src_row.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity in source' USING ERRCODE = '23514';
  END IF;
  v_item_id := v_src_row.item_id;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_dst_page::text || '|' || p_dst_slot::text, 0)
  );
  SELECT * INTO v_dst_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_dst_page AND slot = p_dst_slot FOR UPDATE;
  -- CAPTURE this BEFORE the source UPDATE/DELETE clobbers FOUND.
  v_dst_existed := FOUND;
  IF v_dst_existed AND v_dst_row.item_id <> v_item_id THEN
    RAISE EXCEPTION 'Destination occupied by a different item' USING ERRCODE = '23505';
  END IF;

  IF v_src_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_src_row.id;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity WHERE id = v_src_row.id;
  END IF;

  IF v_dst_existed THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + p_quantity WHERE id = v_dst_row.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_dst_jsonb FROM updated;
  ELSE
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_dst_page, p_dst_slot, v_item_id, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_dst_jsonb FROM inserted;
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;
  PERFORM _log_item_history(
    v_user_id, 'transfer', v_item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', 'vault', 'page', p_src_page, 'slot', p_src_slot),
    jsonb_build_object('kind', 'vault', 'page', p_dst_page, 'slot', p_dst_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'destination_row', v_dst_jsonb,
    'item_id', v_item_id,
    'quantity', p_quantity
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 3+4. vault_set_slot — add FOR UPDATE + advisory lock, refuse replace
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vault_set_slot(
  p_page              INTEGER,
  p_slot              INTEGER,
  p_item_id           UUID,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_existing    RECORD;
  v_rows        JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_page IS NULL OR p_page < 0 OR p_page > 31 THEN
    RAISE EXCEPTION 'Invalid page %', p_page USING ERRCODE = '22023';
  END IF;
  IF p_slot IS NULL OR p_slot < 0 OR p_slot > 255 THEN
    RAISE EXCEPTION 'Invalid slot %', p_slot USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(v.*)) INTO v_rows FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_page AND v.slot = p_slot;
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb),
                             'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  -- Lock the slot before reading it.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_page::text || '|' || p_slot::text, 0)
  );
  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   FOR UPDATE;

  IF FOUND AND v_existing.item_id = p_item_id THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + p_quantity
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  ELSIF FOUND THEN
    -- Refuse rather than silently destroy. Caller must clear the slot
    -- (e.g. pick the existing stack onto cursor) before re-trying.
    RAISE EXCEPTION 'Slot occupied by a different item' USING ERRCODE = '23505';
  ELSE
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_page, p_slot, p_item_id, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  END IF;

  RETURN json_build_object('rows', v_rows, 'deleted_row_ids', '[]'::jsonb, 'replayed', false);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 4. vault_remove_from_slot — add FOR UPDATE + advisory lock
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vault_remove_from_slot(
  p_page              INTEGER,
  p_slot              INTEGER,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_existing    RECORD;
  v_rows        JSONB := '[]'::jsonb;
  v_deleted_ids JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_page::text || '|' || p_slot::text, 0)
  );
  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No vault row at page=% slot=%', p_page, p_slot USING ERRCODE = '23503';
  END IF;
  IF v_existing.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_existing.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  IF v_existing.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_existing.id;
    v_deleted_ids := jsonb_build_array(v_existing.id);
  ELSE
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity - p_quantity
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  END IF;

  RETURN json_build_object('rows', v_rows, 'deleted_row_ids', v_deleted_ids, 'replayed', false);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 4. consume_inventory_target — add FOR UPDATE so concurrent consumes
--    can't both decrement the same row.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_inventory_target(
  p_target            TEXT,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_is_new       BOOLEAN;
  v_existing     RECORD;
  v_rows         JSONB;
  v_deleted_ids  JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_target IS NULL OR p_target = '' THEN
    RAISE EXCEPTION 'target required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  SELECT * INTO v_existing
    FROM user_inventory
   WHERE user_id = v_user_id
     AND (item_type = p_target
          OR (item_id IS NOT NULL AND item_id::text = p_target))
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No inventory row matching target %', p_target USING ERRCODE = '23503';
  END IF;
  IF v_existing.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_existing.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  IF v_existing.quantity = p_quantity THEN
    DELETE FROM user_inventory WHERE id = v_existing.id;
    v_rows := '[]'::jsonb;
    v_deleted_ids := jsonb_build_array(v_existing.id);
  ELSE
    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity - p_quantity, updated_at = NOW()
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    v_deleted_ids := '[]'::jsonb;
  END IF;

  RETURN json_build_object('rows', v_rows, 'deleted_row_ids', v_deleted_ids, 'replayed', false);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 4. grant_inventory_row stackable branch — add advisory lock + FOR
--    UPDATE so two concurrent grants of the same stackable item can't
--    both miss the existing row and create two stacks.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_inventory_row(
  p_item_type         TEXT,
  p_item_id           UUID,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_is_new        BOOLEAN;
  v_item_key      TEXT;
  v_non_stackable BOOLEAN := false;
  v_existing      RECORD;
  v_rows          JSONB;
  v_lock_key      TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_item_type IS NULL OR p_item_type = '' THEN
    RAISE EXCEPTION 'item_type required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(i.*)) INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = v_user_id
       AND i.item_type = p_item_type
       AND (i.item_id = p_item_id OR (i.item_id IS NULL AND p_item_id IS NULL));
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', true);
  END IF;

  IF p_item_type = 'item' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for item_type=item' USING ERRCODE = '22023';
    END IF;
    SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
    IF v_item_key IS NULL THEN
      RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    v_non_stackable :=
          v_item_key = 'health_potion'
       OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
       OR v_item_key = 'diamond'
       OR v_item_key LIKE 'shpider_egg_t%';
  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
  ELSE
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
  END IF;

  IF v_non_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    v_lock_key := v_user_id::text || '|stk|' || p_item_type || '|' || COALESCE(p_item_id::text, 'NULL');
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

    SELECT * INTO v_existing
      FROM user_inventory
     WHERE user_id = v_user_id
       AND item_type = p_item_type
       AND (item_id = p_item_id OR (item_id IS NULL AND p_item_id IS NULL))
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory
           SET quantity = quantity + p_quantity, updated_at = NOW()
         WHERE id = v_existing.id RETURNING *
      ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, p_item_id, p_quantity)
        RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;
