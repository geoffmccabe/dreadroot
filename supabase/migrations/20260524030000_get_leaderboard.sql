-- =====================================================================
-- get_leaderboard(metric, limit) — top-N players by a given stat.
-- =====================================================================
-- Avoids relaxing the user_stats RLS (which restricts SELECT to the
-- user's own row + admins). The function runs as SECURITY DEFINER so
-- it bypasses RLS, but only returns the whitelisted leaderboard
-- columns + display_name for the top N rows. No PII beyond the
-- chosen public display_name.
--
-- Whitelist of metrics is enforced by an IF check, so the format()
-- string-build can't be used to inject an arbitrary column.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_metric TEXT,
  p_limit  INTEGER DEFAULT 100
)
RETURNS TABLE (
  rank          INTEGER,
  user_id       UUID,
  display_name  TEXT,
  value         NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_metric NOT IN (
    'shots_hit',
    'damage_dealt',
    'total_kills',
    'fruits_collected',
    'distance_traveled_blocks'
  ) THEN
    RAISE EXCEPTION 'Invalid metric: %', p_metric USING ERRCODE = '22023';
  END IF;

  IF p_limit < 1 OR p_limit > 500 THEN
    p_limit := 100;
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT
      (ROW_NUMBER() OVER (ORDER BY us.%1$I DESC))::INTEGER AS rank,
      us.user_id,
      COALESCE(NULLIF(up.display_name, ''), 'Player') AS display_name,
      us.%1$I::NUMERIC AS value
    FROM public.user_stats us
    LEFT JOIN public.user_profiles up ON up.user_id = us.user_id
    WHERE us.%1$I > 0
    ORDER BY us.%1$I DESC
    LIMIT $1
  $q$, p_metric) USING p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, INTEGER) TO authenticated;
