-- Starter loadout: what a brand-new player (guest or registered) begins with.
--
-- REPLACES a client-driven grant that was broken in two ways: it handed out
-- FOUR pistols and FOUR flame gloves, and it put them in the BAG. Equipped
-- gear is read from region 'equip', and the hotbar from 'quick_select', so a
-- new player spawned holding nothing and could not fire a shot until they
-- worked out the inventory UI on their own. Nothing on screen said so.
--
-- Doing it server-side also takes the item choice away from the client. The
-- old path called grant_slot with an item id the CLIENT picked, so the
-- "starter grant" was really "grant me anything I name". This function names
-- its own items, its own quantities and its own slots, and refuses to run
-- twice.
--
--   equip slot 1  = left hand  -> Flame Glove  (item 193, tier 1)
--   equip slot 5  = right hand -> Basic Pistol (item 15,  tier 1)
--   quick_select 6              -> Grenade      (item 23,  tier 1)
--   inventory 1,2               -> Grenade x2
--
-- Slots are 1-indexed, matching _first_empty_slot and all live data.
-- Grenades are NOT stackable, so each one needs its own slot.

CREATE OR REPLACE FUNCTION public.grant_starter_loadout()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pistol  UUID;
  v_glove   UUID;
  v_grenade UUID;
  v_rows    JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- One-time, and self-limiting: if this player owns ANY slot in ANY region
  -- they are not new, so there is nothing to do. This is what stops the
  -- function being a free-items faucet.
  IF EXISTS (SELECT 1 FROM user_slots WHERE user_id = v_user_id) THEN
    RETURN json_build_object('granted', false, 'reason', 'not_a_new_player');
  END IF;

  SELECT id INTO v_pistol  FROM items WHERE item_number = 15  LIMIT 1;
  SELECT id INTO v_glove   FROM items WHERE item_number = 193 LIMIT 1;
  SELECT id INTO v_grenade FROM items WHERE item_number = 23  LIMIT 1;

  IF v_pistol IS NULL OR v_glove IS NULL OR v_grenade IS NULL THEN
    RAISE EXCEPTION 'starter items missing from items table'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity) VALUES
    (v_user_id, 'equip',        0, 1, v_glove,   1),
    (v_user_id, 'equip',        0, 5, v_pistol,  1),
    (v_user_id, 'quick_select', 0, 6, v_grenade, 1),
    (v_user_id, 'inventory',    0, 1, v_grenade, 1),
    (v_user_id, 'inventory',    0, 2, v_grenade, 1)
  ON CONFLICT (user_id, region, page, slot) DO NOTHING;

  SELECT jsonb_agg(to_jsonb(s)) INTO v_rows
    FROM user_slots s WHERE s.user_id = v_user_id;

  RETURN json_build_object('granted', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

-- Logged-in callers only. Supabase anonymous ("guest") sessions carry the
-- authenticated role too, which is what lets Play Without Account work.
REVOKE ALL ON FUNCTION public.grant_starter_loadout() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_starter_loadout() TO authenticated;
