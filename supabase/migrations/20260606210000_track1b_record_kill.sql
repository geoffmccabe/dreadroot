-- Track 1B (L1 write API): kill credit via a validated RPC instead of the
-- client doing select-then-update/insert on user_combat_stats directly
-- (6 enemy types × inline blocks in Fortress.tsx).
--
-- Behavior preserved: one row per (user, enemy_type) where enemy_type
-- encodes the tier (e.g. 'shwarm_t3'); kills increments by 1. NOT a plain
-- UPSERT — the unique constraint is (user_id, enemy_type, tier) with tier
-- nullable, so NULL tiers don't dedupe; we replicate the client's
-- match-on-enemy_type logic, guarded by an advisory lock to fix the
-- read-then-write race the client had.
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
