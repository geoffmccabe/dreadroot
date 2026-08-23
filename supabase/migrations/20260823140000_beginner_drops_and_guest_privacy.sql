-- Two things, both about a new player's first hour.
--
-- 1) BEGINNER DROPS. The first 10 monsters a player kills always drop an item
--    from the normal drop table, instead of rolling against the drop rate. A
--    new player who kills ten things and sees nothing has no reason to keep
--    playing; this guarantees the early loop pays out.
--
-- 2) GUEST DROPS ARE PRIVATE. Guest accounts are free and unlimited, so
--    anything a guest can hand to a real account is a mint: farm on throwaway
--    guests, drop the loot on the ground, pick it up on your real character.
--    A guest's world drops are therefore visible to, and pickable by, only
--    that guest.
--
--    "No KYC" currently means "anonymous auth user" — that is the only
--    unverified account type today. If a real KYC flag arrives later, the
--    trigger below is the single place that decides.

-- ── 1. Privacy column ────────────────────────────────────────────────────────
ALTER TABLE public.world_drops
  ADD COLUMN IF NOT EXISTS private_to_user UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS world_drops_private_to_user_idx
  ON public.world_drops(private_to_user) WHERE private_to_user IS NOT NULL;

-- Everyone could read every drop. Now a private drop is visible only to its
-- owner. Public drops (private_to_user IS NULL) behave exactly as before.
DROP POLICY IF EXISTS "Authenticated users read all world drops" ON public.world_drops;
CREATE POLICY "Read public drops, plus your own private ones"
  ON public.world_drops FOR SELECT
  USING (private_to_user IS NULL OR private_to_user = auth.uid());

-- ── 2. One trigger marks every guest drop, whatever route created it ─────────
-- Doing this as a trigger rather than editing each RPC means spawn_world_drop,
-- eject_slot_to_world, roll_shwarm_drop AND anything added later are all
-- covered, and none of them can forget.
CREATE OR REPLACE FUNCTION public._mark_guest_world_drop()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_is_anon BOOLEAN;
BEGIN
  IF NEW.private_to_user IS NOT NULL OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT is_anonymous INTO v_is_anon FROM auth.users WHERE id = v_uid;
  IF COALESCE(v_is_anon, false) THEN
    NEW.private_to_user := v_uid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS world_drops_guest_privacy ON public.world_drops;
CREATE TRIGGER world_drops_guest_privacy
  BEFORE INSERT ON public.world_drops
  FOR EACH ROW EXECUTE FUNCTION public._mark_guest_world_drop();

-- ── 3. Pickup must respect it ────────────────────────────────────────────────
-- RLS hides private drops from other players' reads, but pickup_world_drop is
-- SECURITY DEFINER and therefore bypasses RLS entirely. Without this check a
-- player who learned a drop id could still take it.
CREATE OR REPLACE FUNCTION public.pickup_world_drop(
  p_drop_id UUID,
  p_client_request_id UUID
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_drop      RECORD;
  v_item_key  TEXT;
  v_slot      INTEGER;
  v_row       RECORD;
  v_region    TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_drop_id IS NULL THEN
    RAISE EXCEPTION 'drop_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT * INTO v_drop FROM world_drops WHERE id = p_drop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Drop % not found', p_drop_id USING ERRCODE = '23503';
  END IF;

  -- A guest's drops belong to that guest alone.
  IF v_drop.private_to_user IS NOT NULL AND v_drop.private_to_user <> v_user_id THEN
    RAISE EXCEPTION 'That drop is not yours' USING ERRCODE = '42501';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_drop.item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item def missing for %', v_drop.item_id USING ERRCODE = '23503';
  END IF;

  -- Inventory first (18 slots, 1..18, no stacking), then quick-select.
  v_slot   := public._first_empty_slot(v_user_id, 'inventory', 0);
  v_region := 'inventory';
  IF v_slot IS NULL THEN
    v_slot   := public._first_empty_slot(v_user_id, 'quick_select', 0);
    v_region := 'quick_select';
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'No empty inventory or quick-select slot; pickup refused'
        USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
    END IF;
  END IF;

  DELETE FROM world_drops WHERE id = p_drop_id;

  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
  VALUES (v_user_id, v_region, 0, v_slot, v_drop.item_id, 1)
  RETURNING * INTO v_row;

  PERFORM _log_item_history(
    v_user_id, 'pickup', v_drop.item_id, v_item_key, 1,
    jsonb_build_object('kind', 'world_drop', 'drop_id', p_drop_id),
    jsonb_build_object('region', v_region, 'page', 0, 'slot', v_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'rows', jsonb_build_array(row_to_json(v_row)),
    'deleted_world_drop_id', p_drop_id,
    'region', v_region,
    'slot', v_slot
  );
END;
$$;

-- ── 4. Beginner drops ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beginner_drop_progress (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.beginner_drop_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beginner_drop_progress FROM PUBLIC, anon, authenticated;

-- How many guaranteed drops a new player gets.
CREATE OR REPLACE FUNCTION public.beginner_drop_total() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;

CREATE OR REPLACE FUNCTION public.roll_shwarm_drop(
  p_tier INTEGER,
  p_x REAL,
  p_y REAL,
  p_z REAL,
  p_client_request_id UUID
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid(); v_is_new BOOLEAN;
  v_drop_rate NUMERIC; v_table_code TEXT; v_table_id UUID;
  v_total NUMERIC; v_roll NUMERIC; v_item_number INTEGER; v_item_id UUID; v_row RECORD;
  v_granted INTEGER; v_beginner BOOLEAN := false; v_cap INTEGER := public.beginner_drop_total();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id required' USING ERRCODE='22023'; END IF;
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('dropped', false, 'replayed', true); END IF;

  SELECT drop_rate, drop_table_code INTO v_drop_rate, v_table_code
    FROM shwarm_definitions WHERE tier = p_tier;
  IF v_table_code IS NULL THEN RETURN json_build_object('dropped', false); END IF;

  -- Is this one of the player's first N kills? Locked so two kills landing at
  -- once cannot both read the same count and hand out an extra.
  INSERT INTO beginner_drop_progress (user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT granted INTO v_granted FROM beginner_drop_progress
    WHERE user_id = v_user_id FOR UPDATE;
  v_beginner := COALESCE(v_granted, 0) < v_cap;

  -- Beginners skip the rate roll entirely: their first N kills always pay out.
  IF NOT v_beginner THEN
    IF v_drop_rate IS NULL OR v_drop_rate <= 0 THEN RETURN json_build_object('dropped', false); END IF;
    IF random() * 100 >= v_drop_rate THEN RETURN json_build_object('dropped', false); END IF;
  END IF;

  SELECT id INTO v_table_id FROM drop_tables WHERE code = v_table_code;
  IF NOT FOUND THEN RETURN json_build_object('dropped', false); END IF;
  SELECT COALESCE(SUM(weight), 0) INTO v_total FROM drop_table_entries WHERE drop_table_id = v_table_id;
  IF v_total <= 0 THEN RETURN json_build_object('dropped', false); END IF;

  v_roll := random() * v_total;
  SELECT q.item_number INTO v_item_number FROM (
    SELECT item_number, SUM(weight) OVER (ORDER BY sort_order, id) AS cum
    FROM drop_table_entries WHERE drop_table_id = v_table_id
  ) q WHERE q.cum > v_roll ORDER BY q.cum LIMIT 1;
  IF v_item_number IS NULL OR v_item_number < 0 THEN RETURN json_build_object('dropped', false); END IF;
  SELECT id INTO v_item_id FROM items WHERE item_number = v_item_number LIMIT 1;
  IF v_item_id IS NULL THEN RETURN json_build_object('dropped', false); END IF;

  INSERT INTO world_drops (item_id, killer_user_id, position_x, position_y, position_z)
  VALUES (v_item_id, v_user_id, p_x, p_y, p_z) RETURNING * INTO v_row;

  -- Only count a beginner drop once an item actually hit the ground, so an
  -- empty drop table can never silently burn the allowance.
  IF v_beginner THEN
    UPDATE beginner_drop_progress
       SET granted = granted + 1, updated_at = now()
     WHERE user_id = v_user_id;
    v_granted := COALESCE(v_granted, 0) + 1;
  END IF;

  RETURN json_build_object(
    'dropped', true,
    'row', row_to_json(v_row),
    'beginner', v_beginner,
    'beginner_index', CASE WHEN v_beginner THEN v_granted ELSE NULL END,
    'beginner_total', v_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.roll_shwarm_drop(INTEGER, REAL, REAL, REAL, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roll_shwarm_drop(INTEGER, REAL, REAL, REAL, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.pickup_world_drop(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_world_drop(UUID, UUID) TO authenticated;
