-- ============================================================================
-- OPTIONAL: bulk backfill of missing tree blocks
-- ============================================================================
-- Run 20260521120000_combined_tree_block_sync_fix.sql FIRST (it creates the
-- functions). This file only triggers the restore.
--
-- NOTE: this is optional. Once the functions exist, the game calls
-- sync_all_missing_tree_blocks(world_id) itself each time a world loads, so
-- missing blocks get restored naturally as you play. This file just forces
-- it to happen now, in bulk.
--
-- WHY IT'S SPLIT OUT: restoring every tree in every world can insert hundreds
-- of thousands of rows. Doing that in one statement can exceed the Supabase
-- dashboard's request timeout ("Failed to fetch (api.supabase.com)"). So run
-- it ONE WORLD AT A TIME using the steps below.
-- ============================================================================

-- STEP 1 — list your worlds that have fully-grown trees (run this by itself):
SELECT w.id, w.name, COUNT(*) AS fully_grown_trees
FROM worlds w
JOIN planted_trees pt ON pt.world_id = w.id
WHERE pt.is_fully_grown = true
GROUP BY w.id, w.name
ORDER BY fully_grown_trees DESC;

-- STEP 2 — for EACH world id from step 1, run this on its own (one at a time),
-- pasting the id in place of the placeholder:
--
--   SELECT public.sync_all_missing_tree_blocks('00000000-0000-0000-0000-000000000000');
--
-- It returns e.g. {"success":true,"trees_processed":12,"total_blocks_inserted":3480}.
-- If a single world is still too big and times out, restore its trees
-- individually instead — list them, then call the per-tree function:
--
--   SELECT id FROM planted_trees
--   WHERE world_id = '00000000-0000-0000-0000-000000000000'
--     AND is_fully_grown = true;
--
--   SELECT public.sync_missing_tree_blocks(
--     '00000000-0000-0000-0000-000000000000',  -- world id
--     '11111111-1111-1111-1111-111111111111'   -- tree id
--   );
--
-- ----------------------------------------------------------------------------
-- ALTERNATIVELY — if you only have a few small worlds, this does them all at
-- once (one request; use only if step-1 counts are modest):
--
--   SELECT w.name, public.sync_all_missing_tree_blocks(w.id)
--   FROM (
--     SELECT DISTINCT w.id, w.name
--     FROM worlds w
--     JOIN planted_trees pt ON pt.world_id = w.id
--     WHERE pt.is_fully_grown = true
--   ) w;
-- ============================================================================
