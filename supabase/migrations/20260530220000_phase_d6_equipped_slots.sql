-- Phase D6 — Equipped-slot write RPCs.
--
-- Three RPCs cover every direct-write site against user_equipped_items:
--   1. set_equipped_slot     — upsert one slot (replaces direct update/insert)
--   2. clear_equipped_slot   — delete one slot
--   3. clear_equipped_slots  — bulk delete several slots in one call
--
-- All RPCs follow the established pattern: auth.uid() check, replay
-- protection via check_and_record_request, return shape
--   { rows: [...], deleted_row_ids: [...], replayed: bool }.
--
-- slot_type validation: must match `hotbar_<digits>` (1–6 today, leaving
-- room for more later).

-- ---------------------------------------------------------------------
-- 1. set_equipped_slot
--    Upserts one (user_id, slot_type) row to point at p_item_id.
--    Race protection: UNIQUE(user_id, slot_type) plus ON CONFLICT DO
--    UPDATE makes two concurrent set calls deterministic — last commit
--    wins, no duplicate rows.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_equipped_slot(
  p_slot_type         TEXT,
  p_item_id           UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_rows        JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_slot_type IS NULL OR p_slot_type !~ '^hotbar_[1-9][0-9]?$' THEN
    RAISE EXCEPTION 'Invalid slot_type %', p_slot_type USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
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
    SELECT jsonb_agg(row_to_json(e.*))
      INTO v_rows
      FROM user_equipped_items e
     WHERE e.user_id = v_user_id AND e.slot_type = p_slot_type;
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  WITH upserted AS (
    INSERT INTO user_equipped_items (user_id, slot_type, item_id, equipped_at)
    VALUES (v_user_id, p_slot_type, p_item_id, NOW())
    ON CONFLICT (user_id, slot_type)
    DO UPDATE SET item_id = EXCLUDED.item_id, equipped_at = NOW()
    RETURNING *
  )
  SELECT jsonb_agg(row_to_json(upserted.*)) INTO v_rows FROM upserted;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', '[]'::jsonb,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_equipped_slot(TEXT, UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. clear_equipped_slot — delete the row at one slot.
--    No-op (replayed-style empty response) if the slot is already empty.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_equipped_slot(
  p_slot_type         TEXT,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_deleted_ids JSONB := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_slot_type IS NULL OR p_slot_type !~ '^hotbar_[1-9][0-9]?$' THEN
    RAISE EXCEPTION 'Invalid slot_type %', p_slot_type USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  WITH deleted AS (
    DELETE FROM user_equipped_items
     WHERE user_id = v_user_id AND slot_type = p_slot_type
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_deleted_ids FROM deleted;

  RETURN json_build_object(
    'rows', '[]'::jsonb,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_equipped_slot(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. clear_equipped_slots — bulk-delete multiple slots in one call.
--    Used by the orphan-cleanup path when an equipped item's inventory
--    row no longer exists.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_equipped_slots(
  p_slot_types        TEXT[],
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_deleted_ids JSONB := '[]'::jsonb;
  v_st          TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_slot_types IS NULL OR array_length(p_slot_types, 1) IS NULL THEN
    RAISE EXCEPTION 'slot_types required' USING ERRCODE = '22023';
  END IF;
  IF array_length(p_slot_types, 1) > 32 THEN
    RAISE EXCEPTION 'Too many slot_types' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  FOREACH v_st IN ARRAY p_slot_types LOOP
    IF v_st IS NULL OR v_st !~ '^hotbar_[1-9][0-9]?$' THEN
      RAISE EXCEPTION 'Invalid slot_type %', v_st USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  WITH deleted AS (
    DELETE FROM user_equipped_items
     WHERE user_id = v_user_id AND slot_type = ANY(p_slot_types)
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_deleted_ids FROM deleted;

  RETURN json_build_object(
    'rows', '[]'::jsonb,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_equipped_slots(TEXT[], UUID) TO authenticated;
