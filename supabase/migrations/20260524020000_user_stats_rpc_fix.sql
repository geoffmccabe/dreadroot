-- =====================================================================
-- Fix bump_user_stats RPC after we dropped blocks_destroyed and
-- trees_chopped from the table (not leaderboard-worthy stats).
--
-- The original RPC body referenced both columns; first call would
-- error with "column does not exist". This replaces it with the
-- corrected body.
-- =====================================================================

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() <> p_user_id
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Cannot modify another user''s stats' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_stats (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

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

  UPDATE public.user_stats SET
    best_killstreak        = GREATEST(best_killstreak, current_killstreak),
    best_enemy_tier_killed = GREATEST(best_enemy_tier_killed, COALESCE((p_delta->>'enemy_tier_killed')::INTEGER, 0))
  WHERE user_id = p_user_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_user_stats(UUID, JSONB) TO authenticated;
