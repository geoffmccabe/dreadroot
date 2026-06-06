-- Track 1B (L1 write API): kill credit via a validated RPC instead of the
-- client doing select-then-update/insert on user_combat_stats directly
-- (6 enemy types × inline blocks in Fortress.tsx).
--
-- Behavior preserved EXACTLY (matches the old inline client code): the
-- tier is encoded in enemy_type (e.g. 'shwarm_t3') and the separate `tier`
-- column (INTEGER NOT NULL DEFAULT 0) is left at 0, exactly as before. So
-- there is one row per (user, enemy_type) and we match on enemy_type, not a
-- plain UPSERT. An advisory lock serializes concurrent kills to fix the
-- read-then-write race the client had.
--
-- KNOWN PRE-EXISTING BUG (not introduced here, fix in the stats slice):
-- get_kill_leaderboard filters enemy_type='shwarm' AND tier=3, but rows are
-- stored as enemy_type='shwarm_t3', tier=0 — so the PER-TIER leaderboard
-- matches nothing. The Kills tab works (keys off the _t{tier} string). Fix
-- = split enemy_type into base name + numeric tier + backfill existing rows.
--
-- Pre-DO note: combat is still client-side, so the server can't yet prove
-- the kill happened — this RPC validates identity + serializes the write
-- and is the chokepoint a future L2 will call authoritatively. A sanity
-- rate cap folds in at Track 6A.

CREATE OR REPLACE FUNCTION public.record_kill(
  p_enemy_type TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_existing RECORD;
  v_kills    INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_enemy_type IS NULL OR p_enemy_type = '' THEN
    RAISE EXCEPTION 'enemy_type required' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent kills for this (user, enemy_type) so two near-
  -- simultaneous kills can't both insert a fresh row.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|kill|' || p_enemy_type, 0)
  );

  SELECT * INTO v_existing FROM user_combat_stats
   WHERE user_id = v_user_id AND enemy_type = p_enemy_type
   LIMIT 1;

  IF FOUND THEN
    UPDATE user_combat_stats
       SET kills = kills + 1, updated_at = NOW()
     WHERE id = v_existing.id
     RETURNING kills INTO v_kills;
  ELSE
    INSERT INTO user_combat_stats (user_id, enemy_type, kills)
    VALUES (v_user_id, p_enemy_type, 1)
    RETURNING kills INTO v_kills;
  END IF;

  RETURN json_build_object('enemy_type', p_enemy_type, 'kills', v_kills);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_kill(TEXT) TO authenticated;
