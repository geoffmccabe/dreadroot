-- Fix: grant_points failing with 22003 "integer out of range".
--
-- user_profiles.total_points was int4 (max ~2.147e9). Once a player crosses that
-- ceiling, grant_points' "total_points + p_amount" overflows and points stop
-- syncing. level_for_points also had a latent overflow: its level-30 threshold
-- (100 * 2^28 ≈ 2.68e10) doesn't fit in int4 either.
--
-- This widens total_points to bigint and makes both functions bigint-safe.
-- Coins has the same theoretical risk but is far from the ceiling — left as-is.

ALTER TABLE public.user_profiles
  ALTER COLUMN total_points TYPE bigint;

-- level_for_points: widen param + threshold to bigint (drop the int4 overload).
DROP FUNCTION IF EXISTS public.level_for_points(integer);

CREATE OR REPLACE FUNCTION public.level_for_points(p_points bigint)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_level     integer := 1;
  v_threshold bigint;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN 1; END IF;
  FOR v_level IN REVERSE 30..2 LOOP
    v_threshold := (100 * (2 ^ (v_level - 2)))::bigint;
    IF p_points >= v_threshold THEN RETURN v_level; END IF;
  END LOOP;
  RETURN 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.level_for_points(bigint) TO authenticated;

-- grant_points: v_new_total is now bigint, so the add + level lookup are safe.
CREATE OR REPLACE FUNCTION public.grant_points(
  p_amount            integer,
  p_client_request_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_is_new    boolean;
  v_old_level integer;
  v_new_total bigint;
  v_new_level integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Invalid amount %', p_amount USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT total_points, current_level INTO v_new_total, v_new_level
      FROM user_profiles WHERE user_id = v_user_id;
    RETURN json_build_object(
      'new_total_points', v_new_total,
      'new_level', v_new_level,
      'leveled_up', false,
      'replayed', true);
  END IF;

  SELECT current_level INTO v_old_level FROM user_profiles WHERE user_id = v_user_id;
  v_old_level := COALESCE(v_old_level, 1);

  UPDATE user_profiles
     SET total_points = COALESCE(total_points, 0) + p_amount,
         updated_at = NOW()
   WHERE user_id = v_user_id
   RETURNING total_points INTO v_new_total;

  IF v_new_total IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '23503';
  END IF;

  v_new_level := level_for_points(v_new_total);

  IF v_new_level <> v_old_level THEN
    UPDATE user_profiles SET current_level = v_new_level WHERE user_id = v_user_id;
  END IF;

  RETURN json_build_object(
    'new_total_points', v_new_total,
    'new_level', v_new_level,
    'leveled_up', v_new_level > v_old_level,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_points(integer, uuid) TO authenticated;
