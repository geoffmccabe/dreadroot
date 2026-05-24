-- =====================================================================
-- Per-tier knockback retune
-- =====================================================================
-- T1 should fly ~10m, T10 ~1m. damageShpider() reads knockback_received
-- and scales velocity by it; hopAI integrates + decays. Linear ramp
-- 2.5 → 0.25 across the 10 tiers gives the target distances.
-- =====================================================================

UPDATE public.shpider_definitions
SET knockback_received = ROUND((2.5 - (tier - 1) * 0.25)::numeric, 3)::real
WHERE tier BETWEEN 1 AND 10;
