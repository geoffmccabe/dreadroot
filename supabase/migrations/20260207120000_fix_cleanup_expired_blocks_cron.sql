-- Replace the broken cleanup-expired-blocks cron job.
-- The old job used net.http_post() to call a non-existent edge function,
-- and pg_net was never enabled, so it failed every 5 minutes.
-- This replaces it with a direct SQL DELETE — no extensions needed.

-- Remove the broken cron job
SELECT cron.unschedule('cleanup-expired-blocks');

-- Re-create with direct SQL delete
SELECT cron.schedule(
  'cleanup-expired-blocks',
  '*/5 * * * *',
  $$DELETE FROM placed_blocks WHERE expires_at IS NOT NULL AND expires_at < now()$$
);
