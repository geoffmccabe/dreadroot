-- Reduce tree growth cron from every minute to every 10 minutes.
-- With 0 growing trees the function is nearly free, but the cron overhead
-- of firing every minute is unnecessary and contributes to CPU usage.

-- Remove existing job
DO $$
BEGIN
  PERFORM cron.unschedule('process_tree_growth');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Re-schedule at 10-minute intervals
SELECT cron.schedule(
  'process_tree_growth',
  '*/10 * * * *',
  $$SELECT process_tree_growth()$$
);
