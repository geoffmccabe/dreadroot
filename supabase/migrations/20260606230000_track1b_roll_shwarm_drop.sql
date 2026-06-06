-- Track 1B (L1 write API): make loot drops server-authoritative.
--
-- Before: the CLIENT rolled the drop (useDropTableCache.rollDrop) using the
-- enemy's drop_rate + drop_table_code, picked the item, then spawned the
-- world_drop. A cheat could inflate the rate, force a hit, or pick any item.
--
-- Now: the client only reports "a shwarm of tier T died at (x,y,z)". The
-- server looks up the rate + table from shwarm_definitions (client can't
-- influence them), does both rolls, picks the weighted item, and inserts the
-- world_drop. Realtime delivers the visual to clients as before.
--
-- Only shwarms have drop tables today (only shwarm_definitions has
-- drop_rate/drop_table_code), so this covers the whole loot-drop surface.
-- The shpider 1% egg is a separate hardcoded drop (handled separately).

CREATE OR REPLACE FUNCTION public.roll_shwarm_drop(
  p_tier              INTEGER,
  p_x                 REAL,
  p_y                 REAL,
  p_z                 REAL,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_drop_rate   NUMERIC;
  v_table_code  TEXT;
  v_table_id    UUID;
  v_total       NUMERIC;
  v_roll        NUMERIC;
  v_item_number INTEGER;
  v_item_id     UUID;
  v_row         RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- Replay protection: a kill reported twice can't double-spawn.
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('dropped', false, 'replayed', true);
  END IF;

  -- Rate + table come from the definition, NOT the client.
  SELECT drop_rate, drop_table_code
    INTO v_drop_rate, v_table_code
    FROM shwarm_definitions WHERE tier = p_tier;
  IF v_drop_rate IS NULL OR v_table_code IS NULL OR v_drop_rate <= 0 THEN
    RETURN json_build_object('dropped', false);
  END IF;

  -- Roll 1: does anything drop? (drop_rate is a percentage)
  IF random() * 100 >= v_drop_rate THEN
    RETURN json_build_object('dropped', false);
  END IF;

  SELECT id INTO v_table_id FROM drop_tables WHERE code = v_table_code;
  IF NOT FOUND THEN
    RETURN json_build_object('dropped', false);
  END IF;

  SELECT COALESCE(SUM(weight), 0) INTO v_total
    FROM drop_table_entries WHERE drop_table_id = v_table_id;
  IF v_total <= 0 THEN
    RETURN json_build_object('dropped', false);
  END IF;

  -- Roll 2: weighted pick — first entry whose cumulative weight passes the roll.
  v_roll := random() * v_total;
  SELECT q.item_number INTO v_item_number
    FROM (
      SELECT item_number,
             SUM(weight) OVER (ORDER BY sort_order, id) AS cum
        FROM drop_table_entries
       WHERE drop_table_id = v_table_id
    ) q
   WHERE q.cum > v_roll
   ORDER BY q.cum
   LIMIT 1;

  -- A negative/unknown item_number is a "nothing" slot → no drop.
  IF v_item_number IS NULL OR v_item_number < 0 THEN
    RETURN json_build_object('dropped', false);
  END IF;
  SELECT id INTO v_item_id FROM items WHERE item_number = v_item_number LIMIT 1;
  IF v_item_id IS NULL THEN
    RETURN json_build_object('dropped', false);
  END IF;

  INSERT INTO world_drops (item_id, killer_user_id, position_x, position_y, position_z)
  VALUES (v_item_id, v_user_id, p_x, p_y, p_z)
  RETURNING * INTO v_row;

  RETURN json_build_object('dropped', true, 'row', row_to_json(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.roll_shwarm_drop(INTEGER, REAL, REAL, REAL, UUID) TO authenticated;
