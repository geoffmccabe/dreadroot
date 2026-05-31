-- Architectural correction. The user's rule (stated many times):
--
--   * Items (item_type='item') NEVER stack in user_inventory. Every
--     unit is its own row, every row renders as its own tile.
--   * Items DO stack in user_vault — one slot can hold many units.
--   * Blocks (item_id IS NULL) and seeds (item_type LIKE 'seed_tier_%')
--     still stack in user_inventory (they're resources, not discrete
--     instances).
--
-- The 20260601130000 migration (items.stackable + uniqueness trigger
-- + consolidation) implemented the OPPOSITE rule by accident — it
-- collapsed 128 pistol rows into one row of quantity=128, so the
-- inventory tile rendered "128x" instead of 128 individual pistols.
-- This migration reverses it:
--
--   1. Sets items.stackable = FALSE for every item (the column stays
--      for future use, but means "this item does not stack in inv"
--      now, which after this update is true of all items).
--   2. Splits every consolidated item row back into per-unit rows.
--   3. Adds a DB-level trigger: item rows in user_inventory must
--      have quantity=1. No future code path (RPC, admin SQL, future
--      bug) can re-create stacked item rows.
--   4. Updates transfer_vault_to_inventory + grant_inventory_row to
--      always insert per-unit rows for items.
--
-- The 20260601130000 stackable-uniqueness trigger stays — it's a
-- no-op for items now (stackable=false → trigger returns NEW
-- without enforcing), and its block/seed branches are still correct.

-- ────────────────────────────────────────────────────────────────────
-- 1. items.stackable = FALSE for everything
-- ────────────────────────────────────────────────────────────────────
UPDATE public.items SET stackable = FALSE WHERE stackable IS DISTINCT FROM FALSE;

-- ────────────────────────────────────────────────────────────────────
-- 2. Un-consolidate: split every item row with quantity > 1 into
-- N rows of quantity=1.
--
-- Done in three steps inside a single transaction:
--   a. Snapshot the rows that need splitting + their original qty.
--   b. INSERT (quantity-1) extra rows per snapshot.
--   c. UPDATE the original rows to quantity=1.
--
-- Done BEFORE the new qty=1 trigger is installed; otherwise step c
-- would be blocked by the trigger itself (it only allows qty=1).
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_inserted INTEGER;
  v_updated INTEGER;
BEGIN
  CREATE TEMP TABLE _to_split ON COMMIT DROP AS
    SELECT id, user_id, item_type, item_id, quantity
      FROM user_inventory
     WHERE item_type = 'item'
       AND item_id IS NOT NULL
       AND quantity > 1;

  INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
  SELECT s.user_id, s.item_type, s.item_id, 1
    FROM _to_split s
    CROSS JOIN LATERAL generate_series(1, s.quantity - 1) AS extras(g);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE user_inventory ui
     SET quantity = 1, updated_at = NOW()
    FROM _to_split s
   WHERE ui.id = s.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE 'Split: % source rows updated to qty=1, % new per-unit rows inserted',
    v_updated, v_inserted;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Storage-layer invariant: item rows in user_inventory MUST be
-- quantity=1. Any future INSERT or UPDATE that violates this gets
-- 23514. Can't be bypassed by RPCs, admin SQL, or future bugs.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_item_inventory_unit_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.item_type = 'item' AND NEW.item_id IS NOT NULL AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_inventory item rows must have quantity=1 (attempted %, user=%, item=%) — items never stack in inventory; use user_vault for stacked storage',
      NEW.quantity, NEW.user_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_inventory_item_unit_quantity_trigger ON public.user_inventory;
CREATE TRIGGER user_inventory_item_unit_quantity_trigger
  BEFORE INSERT OR UPDATE ON public.user_inventory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_item_inventory_unit_quantity();

-- ────────────────────────────────────────────────────────────────────
-- 4. RPC update: transfer_vault_to_inventory always inserts per-unit
-- for items (no stackable branch — wouldn't pass the new trigger
-- anyway). Vault decrement / replay / history unchanged.
-- ────────────────────────────────────────────────────────────────────
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
    RETURN json_build_object('replayed', true,
      'inventory_rows', '[]'::jsonb,
      'vault_remaining', 0,
      'item_id', NULL, 'quantity', 0);
  END IF;

  SELECT * INTO v_vault_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_source_page AND slot = p_source_slot
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source vault slot empty' USING ERRCODE = '23503'; END IF;
  IF v_vault_row.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_vault_row.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  v_item_id := v_vault_row.item_id;
  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Source item % not found in items table', v_item_id USING ERRCODE = '23503';
  END IF;

  -- Decrement / delete vault row.
  IF v_vault_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_vault_row.id;
    v_remaining := 0;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity
     WHERE id = v_vault_row.id
     RETURNING quantity INTO v_remaining;
  END IF;

  -- Always insert per-unit. The qty=1 trigger would reject anything
  -- else; this code makes the intent explicit.
  WITH inserted AS (
    INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
    SELECT v_user_id, 'item', v_item_id, 1
      FROM generate_series(1, p_quantity)
    RETURNING *
  ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;

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

-- ────────────────────────────────────────────────────────────────────
-- 5. RPC update: grant_inventory_row for item_type='item' always
-- inserts per-unit. Seeds + blocks keep their existing stack-or-
-- insert behavior.
-- ────────────────────────────────────────────────────────────────────
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
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_item_key   TEXT;
  v_existing   RECORD;
  v_rows       JSONB;
  v_lock_key   TEXT;
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
    -- Always per-unit for items.
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, 'item', p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    -- Seeds stack: lock + stack-or-insert.
    v_lock_key := v_user_id::text || '|stk|' || p_item_type || '|' || COALESCE(p_item_id::text, 'NULL');
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    SELECT * INTO v_existing FROM user_inventory
     WHERE user_id = v_user_id AND item_type = p_item_type AND item_id = p_item_id
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
         WHERE id = v_existing.id RETURNING *
      ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, p_item_id, p_quantity) RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  ELSE
    -- Block: stacks per (user, type).
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
    v_lock_key := v_user_id::text || '|stk|' || p_item_type || '|NULL';
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    SELECT * INTO v_existing FROM user_inventory
     WHERE user_id = v_user_id AND item_type = p_item_type AND item_id IS NULL
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
         WHERE id = v_existing.id RETURNING *
      ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, NULL, p_quantity) RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;
