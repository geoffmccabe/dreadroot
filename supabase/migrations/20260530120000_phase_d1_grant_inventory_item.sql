-- Phase D1 — Foundation for the L1 Write API.
--
-- Adds:
--   1. request_dedupe table (replay protection state)
--   2. check_and_record_request() helper — atomic dedupe-or-record
--   3. grant_inventory_item() RPC — first concrete L1 write
--
-- Every L1 write RPC follows the pattern this one establishes:
--   • auth.uid() check at the top — rejects unauthenticated calls
--   • check_and_record_request() — rejects replay attacks
--   • parameter validation (caps, types)
--   • SECURITY DEFINER so the function bypasses RLS internally
--   • returns json with { rows: [...], replayed: bool }
--
-- L2 DO note: when the L2 takes over inventory writes later, the same
-- RPC contract holds — only the underlying writer changes. Client code
-- talking to worldStore.grantInventoryItem doesn't need to change.

-- ---------------------------------------------------------------------
-- 1. Replay-protection state
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.request_dedupe (
  request_id  UUID PRIMARY KEY,
  user_id     UUID NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_dedupe_inserted_at_idx
  ON public.request_dedupe (inserted_at);

-- (Cleanup of old rows can come later via an edge function; the table
-- grows ~1 row per write per user, which Postgres handles easily.)

-- ---------------------------------------------------------------------
-- 2. check_and_record_request — atomic dedupe-or-record
--    Returns true if this is a NEW request, false if it's a replay.
--    Used at the top of every L1 write RPC.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_record_request(
  p_request_id UUID,
  p_user_id    UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  INSERT INTO public.request_dedupe (request_id, user_id)
  VALUES (p_request_id, p_user_id)
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. grant_inventory_item — first L1 write RPC
--    Adds items to the caller's inventory. Handles stackable vs
--    non-stackable (each non-stackable unit = its own row).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_inventory_item(
  p_item_id           UUID,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_is_new        BOOLEAN;
  v_item_key      TEXT;
  v_non_stackable BOOLEAN;
  v_existing      RECORD;
  v_rows          JSONB;
BEGIN
  -- ── 0. Auth + param validation ──
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- ── 1. Replay protection ──
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    -- Replay: return whatever currently exists for this item, mark replayed.
    SELECT jsonb_agg(row_to_json(i.*))
      INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = v_user_id
       AND i.item_type = 'item'
       AND i.item_id = p_item_id;
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', true);
  END IF;

  -- ── 2. Item lookup + stackability ──
  SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_non_stackable := v_item_key = 'health_potion'
    OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
    OR v_item_key = 'diamond'
    OR v_item_key LIKE 'shpider_egg_t%';

  -- ── 3. Apply the grant ──
  IF v_non_stackable THEN
    -- One row per unit (the grid tile IS the row for these).
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, 'item', p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Stackable: increment existing row or insert new.
    SELECT * INTO v_existing
      FROM user_inventory
     WHERE user_id = v_user_id
       AND item_type = 'item'
       AND item_id = p_item_id
     LIMIT 1;

    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory
           SET quantity = quantity + p_quantity,
               updated_at = NOW()
         WHERE id = v_existing.id
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, 'item', p_item_id, p_quantity)
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_inventory_item(UUID, INTEGER, UUID) TO authenticated;
