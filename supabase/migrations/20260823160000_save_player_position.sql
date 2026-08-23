-- Remember where the player was standing.
--
-- Everything else already persists the moment it changes -- items, the blocks
-- you placed, coins, points, health, level all live in Supabase and are
-- written by the RPC that changed them. There was no "unsaved game".
--
-- The ONE exception was your position: the camera starts at a fixed point for
-- everybody, every session. So "log back in and it just works" was true of
-- your stuff and false of where you were, which is the part a player actually
-- notices.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_x REAL,
  ADD COLUMN IF NOT EXISTS last_y REAL,
  ADD COLUMN IF NOT EXISTS last_z REAL,
  ADD COLUMN IF NOT EXISTS last_position_at TIMESTAMPTZ;

-- Written through an RPC rather than a direct UPDATE so the values are
-- sanity-checked in one place. A NaN or a wild coordinate here would strand
-- the player outside the world on their next login with no way back, and it
-- would look like the save feature broke their account.
CREATE OR REPLACE FUNCTION public.save_player_position(
  p_x REAL,
  p_y REAL,
  p_z REAL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Reject anything that is not a usable coordinate. 'infinity'/'NaN' are
  -- legal REAL values in Postgres, so this has to be explicit.
  IF p_x IS NULL OR p_y IS NULL OR p_z IS NULL
     OR p_x <> p_x OR p_y <> p_y OR p_z <> p_z
     OR abs(p_x) > 100000 OR abs(p_z) > 100000
     OR p_y < -1000 OR p_y > 100000 THEN
    RETURN json_build_object('saved', false, 'reason', 'out_of_range');
  END IF;

  UPDATE user_profiles
     SET last_x = p_x, last_y = p_y, last_z = p_z,
         last_position_at = now(), updated_at = now()
   WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('saved', false, 'reason', 'no_profile');
  END IF;
  RETURN json_build_object('saved', true);
END;
$$;

REVOKE ALL ON FUNCTION public.save_player_position(REAL, REAL, REAL) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_player_position(REAL, REAL, REAL) TO authenticated;
