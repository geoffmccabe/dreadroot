-- Phase D3 — Generic grant_inventory_row RPC.
--
-- D1's grant_inventory_item only handled item_type='item'. Wisp blocks
-- (item_type='stone' / 'dirt' / etc., item_id=NULL) and seeds
-- (item_type='seed_tier_N', item_id=seedDefId) use different shapes.
-- Rather than three RPCs, this generic one handles all three patterns
-- with type-specific validation.
--
-- Drops the D1 function so there's one canonical write path.

DROP FUNCTION IF EXISTS public.grant_inventory_item(UUID, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.grant_inventory_row(
  p_item_type         TEXT,
  p_item_id           UUID,  -- NULL allowed (blocks)
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
  v_non_stackable BOOLEAN := false;
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
  IF p_item_type IS NULL OR p_item_type = '' THEN
    RAISE EXCEPTION 'item_type required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- ── 1. Replay protection ──
  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(i.*))
      INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = v_user_id
       AND i.item_type = p_item_type
       AND (i.item_id = p_item_id OR (i.item_id IS NULL AND p_item_id IS NULL));
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', true);
  END IF;

  -- ── 2. Type-specific validation + stackability ──
  IF p_item_type = 'item' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for item_type=item' USING ERRCODE = '22023';
    END IF;
    SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
    IF v_item_key IS NULL THEN
      RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    v_non_stackable := v_item_key = 'health_potion'
      OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
      OR v_item_key = 'diamond'
      OR v_item_key LIKE 'shpider_egg_t%';
  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    -- Seeds always stack
  ELSE
    -- Treat as a block key. Validate against blocks table.
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
    -- Blocks always stack
  END IF;

  -- ── 3. Apply the grant ──
  IF v_non_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Stackable: find existing or insert new
    SELECT * INTO v_existing
      FROM user_inventory
     WHERE user_id = v_user_id
       AND item_type = p_item_type
       AND (item_id = p_item_id OR (item_id IS NULL AND p_item_id IS NULL))
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
        VALUES (v_user_id, p_item_type, p_item_id, p_quantity)
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_inventory_row(TEXT, UUID, INTEGER, UUID) TO authenticated;
