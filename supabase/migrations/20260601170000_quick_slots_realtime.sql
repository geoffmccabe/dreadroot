-- Ensure user_equipped_items is in the Supabase realtime publication.
-- Realtime in Supabase is opt-in per table — if the table isn't in the
-- supabase_realtime publication, postgres_changes subscriptions on
-- that table receive NO events. The client subscribes, the server
-- never delivers, and local state silently goes stale.
--
-- This came up because: after the QS-as-storage refactor (migration
-- 20260601160000), every cross-region drop involving QS writes to
-- user_equipped_items. The client subscribed to row changes in
-- v4.10.17 but the table wasn't in the publication, so the subscription
-- was a no-op. UI appeared frozen after each drop ("item disappeared").

DO $$
BEGIN
  -- Add the table only if it isn't already in the publication.
  -- ADD TABLE fails if it's already there; the existence check is the
  -- safe path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'user_equipped_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_equipped_items';
    RAISE NOTICE 'Added user_equipped_items to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'user_equipped_items already in supabase_realtime publication — no change';
  END IF;
END$$;

-- Also ensure REPLICA IDENTITY is set high enough to deliver the OLD
-- record on UPDATE/DELETE. Without this the subscription receives
-- INSERT events but loses DELETE/UPDATE row data.
ALTER TABLE public.user_equipped_items REPLICA IDENTITY FULL;
