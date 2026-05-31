-- Phase D8 — RLS lockdown for inventory / vault / vault_config / equipped.
--
-- This closes the door to direct INSERT/UPDATE/DELETE on the four L1
-- game-state tables that route 100% through worldStore RPCs.
--
-- Pattern per table:
--   1. Drop every existing policy (we don't trust their names — the
--      history shows policies have been re-created several times)
--   2. Re-create a single SELECT policy ("users read own rows")
--   3. RLS stays ENABLED — no policy match = denied for writes
--
-- SECURITY DEFINER RPCs bypass RLS by design, so all worldStore writes
-- continue to work. Direct supabase.from(...).insert/update/delete by
-- the authenticated client will now error with code 42501.
--
-- NOT included in this lockdown (yet):
--   • user_token_balances — has 2 remaining direct writes
--     (updateBlockchainAddress + admin bulk-seed in
--     AdminPanel.WaterfallControls). Locked in a follow-up after RPCs
--     are added for those paths.
--   • user_profiles — mostly cosmetic edits (display_name, avatar_url,
--     visual_distance, fog_enabled). Game-state writes already use
--     grant_points; profile cosmetics intentionally stay as direct
--     writes with self-row RLS.
--   • placed_blocks, world_eggs, world_drops — chunk/world state,
--     different lockdown concerns, handled when L2 DO lands.

-- ---------------------------------------------------------------------
-- Helper: drop every policy on a given table.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_table   TEXT;
  v_policy  RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'user_inventory',
    'user_vault',
    'user_vault_config',
    'user_equipped_items'
  ]
  LOOP
    FOR v_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        v_policy.policyname, v_table
      );
    END LOOP;
    -- Make sure RLS is on. Already enabled in original migrations, but
    -- belt-and-braces.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------
-- SELECT-only policies. No INSERT/UPDATE/DELETE policies = writes
-- require SECURITY DEFINER (i.e., must come through worldStore RPCs).
-- ---------------------------------------------------------------------
CREATE POLICY "Users read own inventory"
  ON public.user_inventory FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users read own vault"
  ON public.user_vault FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users read own vault config"
  ON public.user_vault_config FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users read own equipped items"
  ON public.user_equipped_items FOR SELECT
  USING (user_id = auth.uid());
