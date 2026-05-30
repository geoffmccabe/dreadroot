-- Phase A3 — server-side debounce on the client-facing trigger_tree_growth
-- wrapper. Removes the per-tab compute-multiplication risk from the
-- 2026-May-17 incident pattern without changing client code or the
-- existing pg_cron schedule.
--
-- Architecture today: trigger_tree_growth is called by every browser tab's
-- useTreeGrowthPoller (1s when player is near a growing tree, 10s
-- otherwise). With N tabs in fast mode, the heavy process_tree_growth
-- function fires N times per second — exactly the failure mode that
-- killed pg_cron on May 17.
--
-- Fix: a single-row debounce table; the wrapper does an atomic
-- compare-and-swap UPDATE — only the first call in each 8-second window
-- actually runs process_tree_growth, all others return a cheap
-- "debounced" result instantly. Per-tab polling becomes safe at any
-- player count.
--
-- pg_cron's direct call to process_tree_growth() is UNCHANGED — cron
-- remains the slow always-on heartbeat, the client wrapper is just the
-- fast-mode UX path.
--
-- L2 DO note: once the L2 owns its tick loop, IT becomes the canonical
-- caller and the per-tab poll path is deleted entirely. This migration
-- is the bridge until then.

-- ---------------------------------------------------------------------
-- 1. Debounce state — single global row, enforced by primary key + check.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tree_growth_debounce (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = true)
);

INSERT INTO public.tree_growth_debounce (id, last_run_at)
VALUES (true, NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Replace trigger_tree_growth with the debounced version.
--    Same return shape — process_tree_growth() returns json, and the
--    "debounced" branch returns a compatible json with zero counters
--    plus a `debounced: true` marker for client-side observability.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_tree_growth()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_debounce_window  INTERVAL    := INTERVAL '8 seconds';
  v_rows             INTEGER;
BEGIN
  -- Atomic compare-and-swap: the UPDATE only matches if no other caller
  -- has won the lock in this debounce window. Whoever updates the row
  -- wins; everyone else gets v_rows = 0 and short-circuits.
  UPDATE public.tree_growth_debounce
     SET last_run_at = v_now
   WHERE id = true
     AND last_run_at < v_now - v_debounce_window;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    RETURN process_tree_growth();
  ELSE
    RETURN json_build_object(
      'debounced',             true,
      'trees_processed',       0,
      'trees_completed',       0,
      'total_blocks_inserted', 0
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_tree_growth() TO authenticated;
