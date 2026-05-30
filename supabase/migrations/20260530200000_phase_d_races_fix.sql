-- Phase D-races — fix race conditions, add quantity guard, standardize
-- replay shapes, tighten validation.
--
-- Audit findings addressed:
--   #1  consume_inventory_target can go silently negative on user_inventory
--   #2  grant_inventory_row can create duplicate stackable rows under load
--   #3  vault_remove_from_slot race throws a cryptic constraint error
--   #4  Replay return shapes were inconsistent
--   #5  grant_inventory_row block branch silently accepts non-null item_id
--   #6  vault_replace_page silently drops invalid input rows
--
-- All function signatures are unchanged; clients keep working without
-- redeploy.

-- ---------------------------------------------------------------------
-- 0. Pre-cleanup: remove any inventory rows with quantity <= 0 so the
--    new CHECK constraint can be applied. Should be zero rows in
--    practice; safe no-op if so.
-- ---------------------------------------------------------------------
DELETE FROM public.user_inventory WHERE quantity <= 0;

-- ---------------------------------------------------------------------
-- 1. Add quantity > 0 guard on user_inventory (matches user_vault).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_inventory_quantity_positive'
  ) THEN
    ALTER TABLE public.user_inventory
      ADD CONSTRAINT user_inventory_quantity_positive
      CHECK (quantity > 0);
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 2. grant_inventory_row — race-safe stackable grants via advisory lock.
--    Standardized replay shape. Block branch enforces item_id IS NULL.
-- ---------------------------------------------------------------------
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
  v_rows          JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_item_type IS NULL OR p_item_type = '' THEN
    RAISE EXCEPTION 'item_type required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- Replay protection
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(i.*))
      INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = v_user_id
       AND i.item_type = p_item_type
       AND (i.item_id = p_item_id OR (i.item_id IS NULL AND p_item_id IS NULL));
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  -- Type-specific validation
  IF p_item_type = 'item' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for item_type=item' USING ERRCODE = '22023';
    END IF;
    SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
    IF v_item_key IS NULL THEN
      RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    v_non_stackable := v_item_key = 'health_potion'
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
    -- Block. Tighten: item_id must be NULL.
    IF p_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'item_id must be NULL for block grants' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
  END IF;

  IF v_non_stackable THEN
    -- Each unit is its own row; no race risk on inserts.
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Stackable. Serialize concurrent grants for the same logical key
    -- via a transaction-scoped advisory lock so two parallel grants
    -- can't both miss the existing row and insert duplicates.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_user_id::text || '|' || p_item_type || '|' || COALESCE(p_item_id::text, ''),
        0
      )
    );

    -- Update the oldest existing row if any.
    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity + p_quantity,
             updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id
            AND item_type = p_item_type
            AND (item_id = p_item_id OR (item_id IS NULL AND p_item_id IS NULL))
          ORDER BY created_at ASC
          LIMIT 1
       )
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;

    IF v_rows IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, p_item_id, p_quantity)
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', '[]'::jsonb,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_inventory_row(TEXT, UUID, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. consume_inventory_target — atomic SELECT FOR UPDATE prevents
--    concurrent consumes from underflowing.
-- ---------------------------------------------------------------------
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
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_row_id      UUID;
  v_remaining   INTEGER;
  v_rows        JSONB := '[]'::jsonb;
  v_deleted_ids JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
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

  -- Atomic: SELECT FOR UPDATE locks the row before we decide what to do,
  -- so a concurrent consume waits for our transaction to finish.
  SELECT id, quantity INTO v_row_id, v_remaining
    FROM user_inventory
   WHERE user_id = v_user_id
     AND (item_type = p_target
          OR (item_id IS NOT NULL AND item_id::text = p_target))
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'No inventory row matching target %', p_target USING ERRCODE = '23503';
  END IF;
  IF v_remaining < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_remaining, p_quantity USING ERRCODE = '23514';
  END IF;

  IF v_remaining = p_quantity THEN
    DELETE FROM user_inventory WHERE id = v_row_id;
    v_deleted_ids := jsonb_build_array(v_row_id);
  ELSE
    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity - p_quantity,
             updated_at = NOW()
       WHERE id = v_row_id
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_inventory_target(TEXT, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. vault_set_slot — advisory lock on (user, page, slot) makes the
--    stack-or-replace atomic; raises a clearer error on conflict.
--    Replay shape includes deleted_row_ids:[].
-- ---------------------------------------------------------------------
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
  v_deleted_ids JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
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
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  -- Serialize concurrent ops on this (user, page, slot).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::text || '|v|' || p_page::text || '|' || p_slot::text,
      0
    )
  );

  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   LIMIT 1;

  IF FOUND AND v_existing.item_id = p_item_id THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + p_quantity
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  ELSE
    IF FOUND THEN
      DELETE FROM user_vault WHERE id = v_existing.id;
      v_deleted_ids := jsonb_build_array(v_existing.id);
    END IF;
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_page, p_slot, p_item_id, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_set_slot(INTEGER, INTEGER, UUID, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. vault_remove_from_slot — atomic SELECT FOR UPDATE.
-- ---------------------------------------------------------------------
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
  v_row_id      UUID;
  v_remaining   INTEGER;
  v_rows        JSONB := '[]'::jsonb;
  v_deleted_ids JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
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

  SELECT id, quantity INTO v_row_id, v_remaining
    FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   LIMIT 1
   FOR UPDATE;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'No vault row at page=% slot=%', p_page, p_slot USING ERRCODE = '23503';
  END IF;
  IF v_remaining < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_remaining, p_quantity USING ERRCODE = '23514';
  END IF;

  IF v_remaining = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_row_id;
    v_deleted_ids := jsonb_build_array(v_row_id);
  ELSE
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity - p_quantity
       WHERE id = v_row_id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_remove_from_slot(INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. vault_replace_page — raise on invalid input rows instead of
--    silently dropping. Replay shape includes deleted_row_ids:[].
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vault_replace_page(
  p_page              INTEGER,
  p_rows              JSONB,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_new   BOOLEAN;
  v_count    INTEGER;
  v_rows     JSONB;
  v_elem     JSONB;
  v_slot     INTEGER;
  v_item_id  UUID;
  v_quantity INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 0 OR p_page > 31 THEN
    RAISE EXCEPTION 'Invalid page %', p_page USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_array_length(p_rows) INTO v_count;
  IF v_count > 256 THEN
    RAISE EXCEPTION 'Too many rows: %', v_count USING ERRCODE = '22023';
  END IF;

  -- Validate every row up front so we fail before mutating state.
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_slot     := (v_elem->>'slot')::INTEGER;
    v_item_id  := (v_elem->>'item_id')::UUID;
    v_quantity := (v_elem->>'quantity')::INTEGER;
    IF v_slot IS NULL OR v_slot < 0 OR v_slot > 255 THEN
      RAISE EXCEPTION 'Invalid slot %', v_slot USING ERRCODE = '22023';
    END IF;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for every row' USING ERRCODE = '22023';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 10000 THEN
      RAISE EXCEPTION 'Invalid quantity %', v_quantity USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM items WHERE id = v_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % not found', v_item_id USING ERRCODE = '23503';
    END IF;
  END LOOP;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(v.*)) INTO v_rows FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_page;
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  DELETE FROM user_vault WHERE user_id = v_user_id AND page = p_page;

  IF v_count > 0 THEN
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      SELECT
        v_user_id, p_page,
        (e->>'slot')::INTEGER,
        (e->>'item_id')::UUID,
        (e->>'quantity')::INTEGER
      FROM jsonb_array_elements(p_rows) AS e
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    v_rows := '[]'::jsonb;
  END IF;

  RETURN json_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'deleted_row_ids', '[]'::jsonb,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_replace_page(INTEGER, JSONB, UUID) TO authenticated;
