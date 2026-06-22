-- Drop the stray 4-arg get_kill_leaderboard(p_enemy_type, p_tier, p_limit, p_game)
-- overload.
--
-- A p_game variant was created directly in the dashboard (never committed as a
-- migration) back when the client passed a game key. The client no longer sends
-- p_game (stats are a single global row per user, not per-game), so it now calls
-- the 3-arg function — but with BOTH overloads present and p_game defaulted,
-- PostgREST can't choose a candidate and the Kills leaderboard errors with
-- "Could not choose the best candidate function between ...".
--
-- Dropping the 4-arg version leaves only the 3-arg function (which includes
-- 'shroomer' in its whitelist), resolving the ambiguity. No data is touched.

DROP FUNCTION IF EXISTS public.get_kill_leaderboard(text, integer, integer, text);
