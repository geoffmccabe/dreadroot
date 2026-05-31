-- Seeds never stack. Each seed is unique — has its own seed # and
-- corresponds to its own blueprint. Two seeds are never interchangeable
-- even if same tier. One row per seed in inventory; vault stores them
-- one per slot (vault stacking would merge distinct seeds, also wrong).
--
-- Parallel to the items qty=1 trigger from 20260601140000, but for
-- seed rows. Updates grant_inventory_row's seed branch to always
-- insert per-unit. Splits existing stacked seed rows.

-- ────────────────────────────────────────────────────────────────────
-- 1. Split existing seed rows with qty > 1 into N rows of qty=1
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_inserted INTEGER;
  v_updated INTEGER;
BEGIN
  CREATE TEMP TABLE _seeds_to_split ON COMMIT DROP AS
    SELECT id, user_id, item_type, item_id, quantity
      FROM user_inventory
     WHERE item_type LIKE 'seed_tier_%'
       AND item_id IS NOT NULL
       AND quantity > 1;

  INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
  SELECT s.user_id, s.item_type, s.item_id, 1
    FROM _seeds_to_split s
    CROSS JOIN LATERAL generate_series(1, s.quantity - 1) AS extras(g);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE user_inventory ui
     SET quantity = 1, updated_at = NOW()
    FROM _seeds_to_split s
   WHERE ui.id = s.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE 'Seed split: % source rows updated, % new per-unit rows inserted',
    v_updated, v_inserted;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Update the qty=1 trigger to ALSO cover seeds. Items + seeds
-- both must be qty=1 in user_inventory.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_item_inventory_unit_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Items: each unit is its own row.
  IF NEW.item_type = 'item' AND NEW.item_id IS NOT NULL AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_inventory item rows must have quantity=1 (attempted %, user=%, item=%) — items never stack in inventory; use user_vault for stacked storage',
      NEW.quantity, NEW.user_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  -- Seeds: each seed is unique (own seed #, own blueprint).
  IF NEW.item_type LIKE 'seed_tier_%' AND NEW.item_id IS NOT NULL AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_inventory seed rows must have quantity=1 (attempted %, user=%, seed=%) — each seed is a unique blueprint; never stack',
      NEW.quantity, NEW.user_id, NEW.item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger itself unchanged; just the function body broadens.

-- ────────────────────────────────────────────────────────────────────
-- 3. grant_inventory_row seed branch — always per-unit, never stack
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
    -- Per-unit for items.
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
    -- Per-unit for seeds. Each seed has its own blueprint; never merge.
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Blocks still stack: lock + stack-or-insert.
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
