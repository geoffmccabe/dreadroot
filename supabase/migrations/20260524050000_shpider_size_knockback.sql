-- =====================================================================
-- Shpider sizing + knockback retune
-- =====================================================================
-- - T1 body+head shrink to 50% of the previous T1 size; each tier
--   adds 10% cumulative growth. So size[T] = 0.5 × T1Original × 1.1^(T-1).
--   T1 body=0.70, head=0.35; T10 body≈1.65, head≈0.825.
-- - Knockback nerf: shpiders take less knockback than shombies because
--   they're bulkier. 1.0 → 0.4 across the board (admins can re-tune).
-- =====================================================================

UPDATE public.shpider_definitions
SET body_size = ROUND((0.7 * power(1.1, tier - 1))::numeric, 3)::real,
    head_size = ROUND((0.35 * power(1.1, tier - 1))::numeric, 3)::real,
    knockback_received = 0.4
WHERE tier BETWEEN 1 AND 10;
