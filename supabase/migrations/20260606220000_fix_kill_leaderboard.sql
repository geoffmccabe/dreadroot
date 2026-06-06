-- Fix the per-tier kill leaderboard.
--
-- Bug: kills are stored with the tier baked into enemy_type (e.g.
-- 'shwarm_t3') and the numeric `tier` column left at 0. But
-- get_kill_leaderboard filtered `enemy_type = 'shwarm' AND tier = 3`, so it
-- matched zero rows — every per-tier leaderboard came back empty.
--
-- Fix: match the way the data is actually stored — reconstruct the stored
-- key from the base name + tier (e.g. 'shwarm' + 3 -> 'shwarm_t3') and
-- filter on that. No kill data is moved or changed; this only corrects the
-- read query. The Kills tab (which keys off the same '_t{tier}' string) is
-- unaffected, and the client still calls this with (base_name, tier).
--
-- (A future normalization could split enemy_type into base + numeric tier
--  and backfill, but that touches the write path and every existing row —
--  out of scope for a read-side fix.)

CREATE OR REPLACE FUNCTION public.get_kill_leaderboard(
  p_enemy_type TEXT,
  p_tier       INTEGER,
  p_limit      INTEGER DEFAULT 20
)
RETURNS TABLE (
  rank         INTEGER,
  user_id      UUID,
  display_name TEXT,
  kills        INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_enemy_type NOT IN (
    'shombie','shnake','walapa','shtickman','shwarm','shpider'
  ) THEN
    RAISE EXCEPTION 'Invalid enemy_type: %', p_enemy_type USING ERRCODE = '22023';
  END IF;

  IF p_limit < 1 OR p_limit > 100 THEN
    p_limit := 20;
  END IF;

  -- Stored key encodes the tier in the text, e.g. 'shwarm_t3'.
  v_key := p_enemy_type || '_t' || p_tier::text;

  RETURN QUERY
    SELECT
      (ROW_NUMBER() OVER (ORDER BY ucs.kills DESC))::INTEGER AS rank,
      ucs.user_id,
      COALESCE(NULLIF(up.display_name, ''), 'Player') AS display_name,
      ucs.kills
    FROM public.user_combat_stats ucs
    LEFT JOIN public.user_profiles up ON up.user_id = ucs.user_id
    WHERE ucs.enemy_type = v_key
      AND ucs.kills      > 0
    ORDER BY ucs.kills DESC
    LIMIT p_limit;
END;
$$;
