-- =====================================================================
-- Resume zombie trees that the 24h cleanup wrongly marked complete.
-- =====================================================================
-- Migration 20260523020000_fix_seed_growth.sql included a one-time
-- UPDATE that set is_fully_grown=true for every tree older than 24
-- hours. The intent was to clear out actually-completed-but-flagged-
-- wrong trees, but the side effect was that any tree which had STALLED
-- mid-growth (cron disabled, server down, etc.) also got marked as
-- grown without its blueprint blocks being placed. Those are zombies:
-- planted_trees says "done", but placed_blocks only has the seed.
--
-- Detection: current_block_count < target_block_count. The growth
-- function only increments current_block_count when it actually places
-- a block, so a tree whose current count is below its target either
-- never finished or had blocks chopped after completion.
--
-- Threshold: we resume any tree with a deficit (full < condition).
-- The growth function is idempotent (ON CONFLICT DO NOTHING on the
-- placed_blocks insert) and time-based, so a tree that was actually
-- complete-but-chopped will just re-place the chopped blocks and
-- finish on the next cron tick. The user-reported intent is "trees
-- that never finished, finish growing" — re-growing a few chopped
-- blocks is the lesser evil compared to leaving real ghost trees.
--
-- planted_at is reset to NOW() so v_expected_orders starts at 0
-- again. Without that, an old zombie would have v_expected_orders
-- much greater than v_max_order on the very first poll, completing
-- the tree after inserting only v_max_blocks_per_tree blocks (the
-- per-run cap) — same zombie state, different timestamp.
-- =====================================================================

UPDATE public.planted_trees
SET
  is_fully_grown = false,
  planted_at     = now(),
  last_growth_at = now()
WHERE is_fully_grown = true
  AND current_block_count < target_block_count;
