-- Track 1B (L1 write API): move shpider-egg drops off the client.
--
-- Before: the client rolled the 1% egg drop on a wild-shpider kill and
-- INSERTED world_eggs directly (and a pet-death refund inserted world_eggs
-- directly too). A cheater could insert world_eggs rows at will = free eggs.
--
-- After:
--   roll_shpider_egg — server does the 1% roll, resolves the egg item, and
--     inserts world_eggs owned by the CALLER. Client only reports the kill.
--   spawn_pet_egg — pet-death refund; centralizes the insert so world_eggs
--     direct writes can be RLS-locked (Track 1D).
--
-- NOTE (not yet fully authoritative — needs L2 pet tracking): combat + pet
-- AI are still client-side, so the server can't prove the kill/pet-death
-- happened or that the caller owns the pet. These RPCs validate identity +
-- replay and own the roll/item, but the "a kill/pet-death occurred" claim is
-- still trusted until L2. spawn_pet_egg trusts p_owner_user_id/p_tier for now
-- (matches current behavior) — tighten when pets become server-authoritative.

-- ── roll_shpider_egg ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.roll_shpider_egg(
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
  v_user_id UUID := auth.uid();
  v_is_new  BOOLEAN;
  v_item_id UUID;
  v_row     RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('dropped', false, 'replayed', true);
  END IF;

  -- 1% drop, rolled server-side.
  IF random() >= 0.01 THEN
    RETURN json_build_object('dropped', false);
  END IF;

  SELECT id INTO v_item_id FROM items WHERE key = 'shpider_egg_t' || p_tier::text LIMIT 1;

  INSERT INTO world_eggs (tier, owner_user_id, position_x, position_y, position_z, item_id)
  VALUES (p_tier, v_user_id, p_x, p_y, p_z, v_item_id)
  RETURNING * INTO v_row;

  RETURN json_build_object('dropped', true, 'tier', p_tier, 'row', row_to_json(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.roll_shpider_egg(INTEGER, REAL, REAL, REAL, UUID) TO authenticated;

-- ── spawn_pet_egg ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spawn_pet_egg(
  p_tier              INTEGER,
  p_owner_user_id     UUID,
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
  v_user_id UUID := auth.uid();
  v_is_new  BOOLEAN;
  v_item_id UUID;
  v_row     RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('spawned', false, 'replayed', true);
  END IF;

  SELECT id INTO v_item_id FROM items WHERE key = 'shpider_egg_t' || p_tier::text LIMIT 1;

  INSERT INTO world_eggs (tier, owner_user_id, position_x, position_y, position_z, item_id)
  VALUES (p_tier, p_owner_user_id, p_x, p_y, p_z, v_item_id)
  RETURNING * INTO v_row;

  RETURN json_build_object('spawned', true, 'row', row_to_json(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION public.spawn_pet_egg(INTEGER, UUID, REAL, REAL, REAL, UUID) TO authenticated;
