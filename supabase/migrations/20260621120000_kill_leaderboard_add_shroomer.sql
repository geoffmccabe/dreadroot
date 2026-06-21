-- Add 'shroomer' to the per-tier kill leaderboard whitelist.
--
-- The kill leaderboard validates p_enemy_type against a hard-coded allow-list.
-- Shroomer was shipped as an enemy (SHIPPED_CREATURE_SLUGS) and is tracked in
-- user_combat_stats like the others, but it was never added to this whitelist,
-- so its leaderboard raised "Invalid enemy_type". Add it. No data is changed —
-- this only widens the read-side allow-list.
--
-- (Same 3-arg signature as before; the client does NOT pass a game — user_stats
--  / user_combat_stats are a single global row per user, not per-game.)

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
    'shombie','shnake','walapa','shtickman','shwarm','shpider','shroomer'
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

GRANT EXECUTE ON FUNCTION public.get_kill_leaderboard(TEXT, INTEGER, INTEGER) TO authenticated;
