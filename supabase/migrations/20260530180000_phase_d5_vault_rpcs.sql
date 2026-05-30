-- Phase D5 — Vault write RPCs.
--
-- Three RPCs mirror useVaultData's three mutators:
--   1. vault_set_slot       — stack-or-replace at (page, slot)
--   2. vault_remove_from_slot — decrement or delete at (page, slot)
--   3. vault_replace_page   — wipe + bulk insert (used by ORG button)
--
-- Plus vault_ensure_config — idempotently creates the first-time
-- user_vault_config row (replaces the direct insert in useVaultData).
--
-- All RPCs use auth.uid() and check_and_record_request, same pattern
-- as D1/D3/D4. Returns shape:
--   { rows: [...], deleted_row_ids: [...], replayed: bool }
-- (vault_ensure_config returns the config row directly.)

-- ---------------------------------------------------------------------
-- 1. vault_set_slot
--    If existing row at (page, slot) has same item_id → quantity += p_quantity.
--    Otherwise → delete existing, insert new. Caller is responsible for
--    moving the displaced stack onto its cursor first (panel does this).
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

  -- Validate the item exists
  PERFORM 1 FROM items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  -- Replay protection
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(v.*))
      INTO v_rows
      FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_page AND v.slot = p_slot;
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  SELECT * INTO v_existing
    FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   LIMIT 1;

  IF FOUND AND v_existing.item_id = p_item_id THEN
    -- Stack
    WITH updated AS (
      UPDATE user_vault
         SET quantity = quantity + p_quantity
       WHERE id = v_existing.id
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
  ELSE
    -- Replace: delete existing (if any), insert new
    IF FOUND THEN
      DELETE FROM user_vault WHERE id = v_existing.id;
      v_deleted_ids := jsonb_build_array(v_existing.id);
    END IF;
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_page, p_slot, p_item_id, p_quantity)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_set_slot(INTEGER, INTEGER, UUID, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. vault_remove_from_slot
--    Decrement at (page, slot). Row deleted if quantity reaches 0.
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
  v_existing    RECORD;
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

  SELECT * INTO v_existing
    FROM user_vault
   WHERE user_id = v_user_id AND page = p_page AND slot = p_slot
   LIMIT 1;

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
      UPDATE user_vault
         SET quantity = quantity - p_quantity
       WHERE id = v_existing.id
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

GRANT EXECUTE ON FUNCTION public.vault_remove_from_slot(INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. vault_replace_page
--    Wipe one page and re-insert the provided rows atomically.
--    p_rows shape: JSON array of {slot:int, item_id:uuid, quantity:int}.
--    Used by the panel's ORG button.
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
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_count       INTEGER;
  v_rows        JSONB;
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

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(v.*))
      INTO v_rows
      FROM user_vault v
     WHERE v.user_id = v_user_id AND v.page = p_page;
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', true);
  END IF;

  -- Wipe page
  DELETE FROM user_vault WHERE user_id = v_user_id AND page = p_page;

  -- Insert new rows. Validate each item_id and quantity inline.
  IF v_count > 0 THEN
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      SELECT
        v_user_id,
        p_page,
        (e->>'slot')::INTEGER,
        (e->>'item_id')::UUID,
        (e->>'quantity')::INTEGER
      FROM jsonb_array_elements(p_rows) AS e
      WHERE (e->>'quantity')::INTEGER > 0
        AND (e->>'quantity')::INTEGER <= 10000
        AND (e->>'slot')::INTEGER BETWEEN 0 AND 255
        AND EXISTS (SELECT 1 FROM items i WHERE i.id = (e->>'item_id')::UUID)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    v_rows := '[]'::jsonb;
  END IF;

  RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_replace_page(INTEGER, JSONB, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. vault_ensure_config
--    Idempotently create the first-time user_vault_config row.
--    Replaces the direct insert in useVaultData. Returns the existing
--    or newly-created config row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vault_ensure_config()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_existing RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM user_vault_config WHERE user_id = v_user_id;
  IF FOUND THEN
    RETURN row_to_json(v_existing);
  END IF;

  INSERT INTO user_vault_config (user_id, page_count, cols, rows)
  VALUES (v_user_id, 4, 5, 5)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing IS NULL THEN
    SELECT * INTO v_existing FROM user_vault_config WHERE user_id = v_user_id;
  END IF;
  RETURN row_to_json(v_existing);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vault_ensure_config() TO authenticated;
