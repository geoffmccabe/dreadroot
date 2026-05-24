-- =====================================================================
-- user_stats — single-row-per-user scalar counters for the admin
-- Stats modal, leaderboards, and contests.
-- =====================================================================
-- Standard FPS-style tracking, organized into combat / world / activity
-- buckets. Per-enemy-type kill detail already lives in user_combat_stats
-- and is joined client-side; this table only stores aggregate counters
-- the game increments at runtime.
--
-- Granular event history (per-shot, per-death) is intentionally NOT
-- here — that'd be a separate events table if/when needed for replays
-- or anti-cheat. Scalar counters are enough for leaderboards.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Combat
  shots_fired              INTEGER NOT NULL DEFAULT 0,
  shots_hit                INTEGER NOT NULL DEFAULT 0,
  headshots                INTEGER NOT NULL DEFAULT 0,
  damage_dealt             REAL    NOT NULL DEFAULT 0,
  damage_taken             REAL    NOT NULL DEFAULT 0,
  total_kills              INTEGER NOT NULL DEFAULT 0,
  total_deaths             INTEGER NOT NULL DEFAULT 0,
  best_killstreak          INTEGER NOT NULL DEFAULT 0,
  current_killstreak       INTEGER NOT NULL DEFAULT 0,
  best_enemy_tier_killed   INTEGER NOT NULL DEFAULT 0,

  -- World / building (blocks_destroyed + trees_chopped intentionally
  -- omitted — destruction isn't a leaderboard-worthy achievement)
  blocks_placed            INTEGER NOT NULL DEFAULT 0,
  trees_planted            INTEGER NOT NULL DEFAULT 0,
  fruits_collected         INTEGER NOT NULL DEFAULT 0,
  fruits_forged            INTEGER NOT NULL DEFAULT 0,
  distance_traveled_blocks REAL    NOT NULL DEFAULT 0,

  -- Activity
  total_play_seconds       INTEGER NOT NULL DEFAULT 0,
  sessions_count           INTEGER NOT NULL DEFAULT 0,
  distinct_days_played     INTEGER NOT NULL DEFAULT 0,
  first_played_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for leaderboard queries.
CREATE INDEX IF NOT EXISTS idx_user_stats_total_kills      ON public.user_stats (total_kills DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_headshots        ON public.user_stats (headshots DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_play_seconds     ON public.user_stats (total_play_seconds DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_best_killstreak  ON public.user_stats (best_killstreak DESC);

-- updated_at trigger reuses the existing helper.
DROP TRIGGER IF EXISTS update_user_stats_updated_at ON public.user_stats;
CREATE TRIGGER update_user_stats_updated_at
  BEFORE UPDATE ON public.user_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: a user reads/writes own row, admins read everyone.
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own stats"        ON public.user_stats;
DROP POLICY IF EXISTS "Admins read all stats"       ON public.user_stats;
DROP POLICY IF EXISTS "Users upsert own stats"      ON public.user_stats;
DROP POLICY IF EXISTS "Users update own stats"      ON public.user_stats;

CREATE POLICY "Users read own stats"
  ON public.user_stats
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all stats"
  ON public.user_stats
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

CREATE POLICY "Users upsert own stats"
  ON public.user_stats
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own stats"
  ON public.user_stats
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- bump_user_stats(p_user_id, p_delta) RPC: atomic counter increment.
-- The client calls this with a JSONB of column -> delta. Lets us track
-- multiple stats in a single round-trip without race conditions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_user_stats(
  p_user_id UUID,
  p_delta   JSONB
)
RETURNS public.user_stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_stats;
BEGIN
  -- Auth: caller must be the user themselves, or an admin.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() <> p_user_id
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Cannot modify another user''s stats' USING ERRCODE = '42501';
  END IF;

  -- Insert the row if it doesn't exist yet (lazy provisioning).
  INSERT INTO public.user_stats (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Apply per-column deltas. Only known columns are touched.
  UPDATE public.user_stats SET
    shots_fired              = shots_fired              + COALESCE((p_delta->>'shots_fired')::INTEGER, 0),
    shots_hit                = shots_hit                + COALESCE((p_delta->>'shots_hit')::INTEGER, 0),
    headshots                = headshots                + COALESCE((p_delta->>'headshots')::INTEGER, 0),
    damage_dealt             = damage_dealt             + COALESCE((p_delta->>'damage_dealt')::REAL, 0),
    damage_taken             = damage_taken             + COALESCE((p_delta->>'damage_taken')::REAL, 0),
    total_kills              = total_kills              + COALESCE((p_delta->>'total_kills')::INTEGER, 0),
    total_deaths             = total_deaths             + COALESCE((p_delta->>'total_deaths')::INTEGER, 0),
    blocks_placed            = blocks_placed            + COALESCE((p_delta->>'blocks_placed')::INTEGER, 0),
    trees_planted            = trees_planted            + COALESCE((p_delta->>'trees_planted')::INTEGER, 0),
    fruits_collected         = fruits_collected         + COALESCE((p_delta->>'fruits_collected')::INTEGER, 0),
    fruits_forged            = fruits_forged            + COALESCE((p_delta->>'fruits_forged')::INTEGER, 0),
    distance_traveled_blocks = distance_traveled_blocks + COALESCE((p_delta->>'distance_traveled_blocks')::REAL, 0),
    total_play_seconds       = total_play_seconds       + COALESCE((p_delta->>'total_play_seconds')::INTEGER, 0),
    current_killstreak       = CASE
                                 WHEN COALESCE((p_delta->>'reset_killstreak')::BOOLEAN, false) THEN 0
                                 ELSE current_killstreak + COALESCE((p_delta->>'total_kills')::INTEGER, 0)
                               END,
    last_played_at           = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  -- Update best_killstreak and best_enemy_tier_killed if surpassed.
  UPDATE public.user_stats SET
    best_killstreak        = GREATEST(best_killstreak, current_killstreak),
    best_enemy_tier_killed = GREATEST(best_enemy_tier_killed, COALESCE((p_delta->>'enemy_tier_killed')::INTEGER, 0))
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_user_stats(UUID, JSONB) TO authenticated;
