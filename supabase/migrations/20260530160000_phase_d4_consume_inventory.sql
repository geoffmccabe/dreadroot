-- Phase D4 — Consume + delete inventory RPCs.
--
-- Two complementary write paths:
--
-- 1. consume_inventory_target(p_target, p_quantity, p_request_id)
--    Decrements p_quantity from the inventory row whose item_type
--    OR item_id::text matches p_target. The "OR" matches both blocks
--    (target = blockKey, matches item_type) and items (target = item
--    UUID, matches item_id). If quantity reaches 0, the row is deleted.
--
-- 2. delete_inventory_row(p_row_id, p_request_id)
--    Deletes a specific row by id. Used for non-stackable items where
--    each row IS a slot (consume = delete that one row).
--
-- Both validate auth.uid() = row.user_id and reject replay attacks
-- via check_and_record_request. Return shape:
--   { rows: [updated_rows], deleted_row_ids: [...], replayed: bool }

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
  -- ── 0. Auth + param validation ──
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

  -- ── 1. Replay protection ──
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  -- ── 2. Find the target row ──
  -- Matches by item_type literal OR by item_id (cast to text for the
  -- compare since p_target is text). UUID rows naturally only match
  -- the item_id side; block keys only match the item_type side.
  SELECT * INTO v_existing
    FROM user_inventory
   WHERE user_id = v_user_id
     AND (item_type = p_target
          OR (item_id IS NOT NULL AND item_id::text = p_target))
   ORDER BY created_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No inventory row matching target %', p_target USING ERRCODE = '23503';
  END IF;

  IF v_existing.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_existing.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  -- ── 3. Decrement or delete ──
  IF v_existing.quantity = p_quantity THEN
    DELETE FROM user_inventory WHERE id = v_existing.id;
    v_rows := '[]'::jsonb;
    v_deleted_ids := jsonb_build_array(v_existing.id);
  ELSE
    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity - p_quantity,
             updated_at = NOW()
       WHERE id = v_existing.id
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    v_deleted_ids := '[]'::jsonb;
  END IF;

  RETURN json_build_object('rows', v_rows, 'deleted_row_ids', v_deleted_ids, 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_inventory_target(TEXT, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_inventory_row(
  p_row_id            UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_deleted_id  UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_row_id IS NULL THEN
    RAISE EXCEPTION 'row_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  DELETE FROM user_inventory
   WHERE id = p_row_id
     AND user_id = v_user_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Row % not found or not owned by user', p_row_id USING ERRCODE = '23503';
  END IF;

  RETURN json_build_object(
    'rows', '[]'::jsonb,
    'deleted_row_ids', jsonb_build_array(v_deleted_id),
    'replayed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_inventory_row(UUID, UUID) TO authenticated;
