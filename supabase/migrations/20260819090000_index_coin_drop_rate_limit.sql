-- PERFORMANCE FIX for the rate limit I added in 20260814120000/20260814140000.
--
-- That limit runs, on EVERY coin drop (i.e. every kill):
--   select count(*), sum(amount) from world_coin_drops
--    where killer_user_id = ... and dropped_at > now() - interval '60 seconds'
--
-- world_coin_drops had no index covering that predicate, so the query planned
-- a SEQUENTIAL SCAN of the whole table. Verified with EXPLAIN ANALYZE:
-- "Seq Scan ... Rows Removed by Filter: 1707".
--
-- Harmless today (1,707 rows, 0.6 ms) but this table only ever grows, and the
-- cost is paid per kill in the middle of combat. Left alone it would degrade
-- linearly and silently: ~35 ms/kill at 100k rows, ~350 ms at 1M.
--
-- The index leads with killer_user_id (equality) then dropped_at (range),
-- which is the right order for this predicate and also serves any
-- "recent drops for this player" query later.
CREATE INDEX IF NOT EXISTS world_coin_drops_killer_recent_idx
  ON public.world_coin_drops (killer_user_id, dropped_at DESC);
