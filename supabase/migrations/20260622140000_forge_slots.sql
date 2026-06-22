-- forge_slots — forge N identical source items (in inventory / quick_select)
-- into 1 of the next tier, operating on the unified user_slots table.
--
-- WHY: the old regular forge used consume_inventory_target + grant_inventory_row,
-- which still target the legacy user_inventory table. Since v4.11.0 items live in
-- user_slots, so that path consumed nothing and dropped the result in the wrong
-- table — the forge silently broke. This RPC does it correctly on user_slots,
-- atomically (all source rows consumed + result granted in one transaction).
--
-- The client passes the exact source row ids (e.g. 4 of a tier) + the resolved
-- next-tier item id. Server validates ownership, same item, and tier+1.

CREATE OR REPLACE FUNCTION public.forge_slots(
  p_source_row_ids    UUID[],
  p_result_item_id    UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_new   BOOLEAN;
  v_n        INT;
  v_item_id  UUID;
  v_src_tier INT;
  v_res      RECORD;
  v_row      RECORD;
  v_slot     INT;
  rid        UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_source_row_ids IS NULL THEN RAISE EXCEPTION 'source_row_ids required' USING ERRCODE = '22023'; END IF;
  v_n := array_length(p_source_row_ids, 1);
  IF v_n IS NULL OR v_n < 2 THEN RAISE EXCEPTION 'at least 2 source rows required' USING ERRCODE = '22023'; END IF;
  IF p_result_item_id IS NULL THEN RAISE EXCEPTION 'result_item_id required' USING ERRCODE = '22023'; END IF;
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_source_row_ids) x) <> v_n THEN
    RAISE EXCEPTION 'source row ids must be distinct' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  -- Validate + lock every source row: caller-owned, in inv/QS, all the same item id.
  FOREACH rid IN ARRAY p_source_row_ids LOOP
    SELECT * INTO v_row FROM user_slots WHERE id = rid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source row % not found', rid USING ERRCODE = '23503'; END IF;
    IF v_row.user_id <> v_user_id THEN RAISE EXCEPTION 'Source rows must belong to caller' USING ERRCODE = '42501'; END IF;
    IF v_row.region NOT IN ('inventory', 'quick_select') THEN
      RAISE EXCEPTION 'Source rows must be in inventory or quick_select' USING ERRCODE = '22023';
    END IF;
    IF v_item_id IS NULL THEN v_item_id := v_row.item_id;
    ELSIF v_row.item_id <> v_item_id THEN
      RAISE EXCEPTION 'All source items must be the same kind + tier' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT tier INTO v_src_tier FROM items WHERE id = v_item_id;
  IF v_src_tier IS NULL THEN RAISE EXCEPTION 'Source item has no tier' USING ERRCODE = '22023'; END IF;

  SELECT id, tier INTO v_res FROM items WHERE id = p_result_item_id;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Result item not found' USING ERRCODE = '23503'; END IF;
  IF v_res.tier IS NULL OR v_res.tier <> v_src_tier + 1 THEN
    RAISE EXCEPTION 'Result must be exactly one tier higher (% -> %)', v_src_tier, v_src_tier + 1 USING ERRCODE = '22023';
  END IF;

  -- Consume the sources.
  DELETE FROM user_slots WHERE id = ANY(p_source_row_ids);

  -- Grant 1 result into the first empty inventory slot.
  SELECT COALESCE(MIN(s), 0) INTO v_slot
    FROM generate_series(0, 255) AS s
   WHERE NOT EXISTS (
     SELECT 1 FROM user_slots
      WHERE user_id = v_user_id AND region = 'inventory' AND page = 0 AND slot = s
   );
  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, 'inventory', 0, v_slot, p_result_item_id, 1);

  RETURN json_build_object('replayed', false, 'result_item_id', p_result_item_id, 'result_slot', v_slot);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forge_slots(UUID[], UUID, UUID) TO authenticated;
