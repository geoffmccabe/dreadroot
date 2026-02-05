-- Fix tree growth: schedule the cron job and mark old trees as fully grown
-- The cron job was commented out, so process_tree_growth() was never being called
-- This caused all trees to stay at is_fully_grown = false forever

-- 1. First, mark ALL trees planted more than 1 hour ago as fully grown
-- These trees should have completed growth long ago
UPDATE planted_trees
SET is_fully_grown = true
WHERE is_fully_grown = false
  AND planted_at < NOW() - INTERVAL '1 hour';

-- 2. Schedule the cron job to run every minute
-- pg_cron only supports minute-level scheduling (not seconds)
-- This ensures future trees will be marked as grown correctly
DO $$
BEGIN
  -- Remove existing job if any (to avoid duplicates)
  PERFORM cron.unschedule('process_tree_growth');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, that's fine
  NULL;
END $$;

SELECT cron.schedule(
  'process_tree_growth',
  '* * * * *',  -- Every minute
  $$SELECT process_tree_growth()$$
);

-- 3. Run process_tree_growth() once immediately to catch any edge cases
SELECT process_tree_growth();
