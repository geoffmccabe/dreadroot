-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup of expired blocks every 5 minutes
-- This calls the cleanup-expired-blocks edge function which deletes expired blocks from the database
SELECT cron.schedule(
  'cleanup-expired-blocks',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://ditecxjpkgbqkeckebzb.supabase.co/functions/v1/cleanup-expired-blocks',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4"}'::jsonb,
        body:=concat('{"timestamp": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);