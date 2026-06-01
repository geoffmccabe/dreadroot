-- One-index every slot. The DB stored slot=0 as the first slot, which
-- is unintuitive when users read DB rows and is also why a starter
-- overflow row at "QS slot 0" was invisible to a UI that iterated 1-6.
--
-- This migration:
--   1. Reduces QS capacity from 10 → 6 (matches the visible hotbar).
--   2. Drops rows that would fall outside the new bounds.
--   3. Shifts every remaining slot value by +1.
--   4. Replaces the CHECK constraint with slot >= 1 AND slot <= capacity.
--   5. Rewrites _slot_capacity and _first_empty_slot for 1-indexed slots.

BEGIN;

-- Step 1: remove rows that won't fit in the new 6-slot QS. Original QS
-- values are 0..9; after the +1 shift the survivors must be 1..6, so
-- we drop the current rows where slot > 5 BEFORE shifting.
DELETE FROM public.user_slots
 WHERE region = 'quick_select'
   AND slot > 5;

-- Step 2: drop the old constraint (0..255) so the shift can land
-- values up to 256 in the vault region.
ALTER TABLE public.user_slots
  DROP CONSTRAINT IF EXISTS user_slots_slot_check;

-- Step 3: shift every slot value by +1.
UPDATE public.user_slots SET slot = slot + 1;

-- Step 4: rewrite the capacity helper. Returns the MAX valid slot
-- number for the region (range is 1..return_value, inclusive).
CREATE OR REPLACE FUNCTION public._slot_capacity(p_region TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_region
    WHEN 'inventory'    THEN 18
    WHEN 'quick_select' THEN 6
    WHEN 'vault'        THEN 256
    ELSE 0
  END;
$$;

-- Step 5: rewrite _first_empty_slot for 1-indexed slots.
CREATE OR REPLACE FUNCTION public._first_empty_slot(
  p_user_id UUID, p_region TEXT, p_page INTEGER
) RETURNS INTEGER LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cap  INTEGER := public._slot_capacity(p_region);
  v_slot INTEGER;
BEGIN
  SELECT s.s INTO v_slot
    FROM generate_series(1, v_cap) AS s(s)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.user_slots us
      WHERE us.user_id = p_user_id
        AND us.region = p_region
        AND us.page = p_page
        AND us.slot = s.s
   )
   ORDER BY s.s
   LIMIT 1;
  RETURN v_slot;
END;
$$;

-- Step 6: add the new CHECK constraint. slot must be >= 1 and <= the
-- region's capacity. Enforced at the row level so a bug elsewhere
-- can't insert an out-of-range slot.
ALTER TABLE public.user_slots
  ADD CONSTRAINT user_slots_slot_check
  CHECK (slot >= 1 AND slot <= public._slot_capacity(region));

COMMIT;
