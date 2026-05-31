-- Add the missing user_inventory.cooldown_until column.
--
-- This column has been referenced by client code (eggs, forge) and
-- by RPCs (pickup_egg, forge_items) using `as any` TypeScript bypasses,
-- but it was never actually added to the table. The pickup_egg RPC
-- has been failing with:
--   "column cooldown_until of relation user_inventory does not exist"
--
-- Adding the column unblocks egg pickup and the forge flow.

ALTER TABLE public.user_inventory
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;
