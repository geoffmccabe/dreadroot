-- =====================================================================
-- Per-tier kill tracking on user_combat_stats + leaderboard RPC.
-- =====================================================================
-- Adds a `tier` dimension to user_combat_stats so leaderboards can be
-- filtered by (enemy_type, tier) without recomputing or caching
-- anything. Existing rows get tier=0 (legacy/unknown). New kill events
-- (instrumented in a later phase) pass the actual tier.
--
-- Performance:
--   Index (enemy_type, tier, kills DESC) makes the top-20 query an
--   index-only seek + 20 rows. Even with millions of users, fetching
--   one leaderboard is sub-millisecond, so on-demand at read time
--   beats any cron/materialized-view scheme.
-- =====================================================================

ALTER TABLE public.user_combat_stats
  ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 0;

-- Old unique constraint (user_id, enemy_type) → new (user_id, enemy_type, tier).
DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.user_combat_stats'::regclass
    AND contype  = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, enemy_type)';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_combat_stats DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.user_combat_stats
  DROP CONSTRAINT IF EXISTS user_combat_stats_user_id_enemy_type_tier_key;
ALTER TABLE public.user_combat_stats
  ADD CONSTRAINT user_combat_stats_user_id_enemy_type_tier_key
    UNIQUE (user_id, enemy_type, tier);

-- Composite index for the leaderboard query.
CREATE INDEX IF NOT EXISTS idx_user_combat_stats_lb
  ON public.user_combat_stats (enemy_type, tier, kills DESC);


-- ---------------------------------------------------------------------
-- get_kill_leaderboard(enemy_type, tier, limit)
-- ---------------------------------------------------------------------
-- Returns top-N players for a specific (enemy_type, tier) combination.
-- SECURITY DEFINER bypasses user_combat_stats RLS; whitelist of
-- enemy_type values prevents arbitrary-column abuse.
-- ---------------------------------------------------------------------
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

  RETURN QUERY
    SELECT
      (ROW_NUMBER() OVER (ORDER BY ucs.kills DESC))::INTEGER AS rank,
      ucs.user_id,
      COALESCE(NULLIF(up.display_name, ''), 'Player') AS display_name,
      ucs.kills
    FROM public.user_combat_stats ucs
    LEFT JOIN public.user_profiles up ON up.user_id = ucs.user_id
    WHERE ucs.enemy_type = p_enemy_type
      AND ucs.tier       = p_tier
      AND ucs.kills      > 0
    ORDER BY ucs.kills DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kill_leaderboard(TEXT, INTEGER, INTEGER) TO authenticated;
