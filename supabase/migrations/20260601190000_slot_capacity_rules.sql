-- Enforce slot capacity rules:
--   Inventory: 18 slots (0..17). Vault: 256 slots/page (0..255). QS: 10 slots (0..9).
--
-- Audit found two bugs in v4.11.0:
--   1. grant_slot scanned slots 0..255 for inventory, so when the
--      visible 18 slots were full, the item was placed at slot 18+
--      and rendered invisible.
--   2. No overflow to QS when inventory was full — items just
--      silently landed in invisible slots OR (if the loop was buggy)
--      no-op'd with no user feedback.
--
-- Rules per the user:
--   - When inventory is full AND QS has space → overflow to QS.
--   - When both full → REFUSE the grant. Item not created.
--   - Ctrl-G admin grant must not bypass capacity.

-- Per-region capacity helper.
CREATE OR REPLACE FUNCTION public._slot_capacity(p_region TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_region
    WHEN 'inventory'    THEN 18
    WHEN 'quick_select' THEN 10
    WHEN 'vault'        THEN 256
    ELSE 0
  END;
$$;

-- Find the first empty slot in a region, page 0 by default. Returns
-- NULL if none free.
CREATE OR REPLACE FUNCTION public._first_empty_slot(
  p_user_id UUID, p_region TEXT, p_page INTEGER
) RETURNS INTEGER LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cap INTEGER := public._slot_capacity(p_region);
  v_slot INTEGER;
BEGIN
  SELECT s.s INTO v_slot
    FROM generate_series(0, v_cap - 1) AS s(s)
   WHERE NOT EXISTS (
     SELECT 1 FROM user_slots us
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

-- ────────────────────────────────────────────────────────────────────
-- Rewrite grant_slot with capacity + INV→QS overflow.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_slot(
  p_region            TEXT,
  p_item_id           UUID,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_item_key  TEXT;
  v_remaining INTEGER;
  v_inserted  INTEGER := 0;
  v_slot      INTEGER;
  v_existing  RECORD;
  v_overflow  BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true, 'granted', 0, 'overflow_to_qs', false);
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_remaining := p_quantity;

  IF p_region IN ('inventory', 'quick_select') THEN
    -- Each unit gets its own slot. Try the requested region first.
    WHILE v_remaining > 0 LOOP
      v_slot := public._first_empty_slot(v_user_id, p_region, 0);
      IF v_slot IS NULL THEN EXIT; END IF;
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (v_user_id, p_region, 0, v_slot, p_item_id, 1);
      v_inserted := v_inserted + 1;
      v_remaining := v_remaining - 1;
    END LOOP;

    -- Overflow from inventory → QS if inventory filled but QS has space.
    -- (The reverse — QS overflowing to inventory — is not requested.)
    IF v_remaining > 0 AND p_region = 'inventory' THEN
      WHILE v_remaining > 0 LOOP
        v_slot := public._first_empty_slot(v_user_id, 'quick_select', 0);
        IF v_slot IS NULL THEN EXIT; END IF;
        INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
        VALUES (v_user_id, 'quick_select', 0, v_slot, p_item_id, 1);
        v_inserted := v_inserted + 1;
        v_remaining := v_remaining - 1;
        v_overflow := true;
      END LOOP;
    END IF;
  ELSE
    -- Vault: try to stack on existing same-item slot, else first empty.
    SELECT * INTO v_existing FROM user_slots
     WHERE user_id = v_user_id AND region = 'vault' AND item_id = p_item_id
     ORDER BY page, slot LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE user_slots SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = v_existing.id;
      v_inserted := p_quantity;
      v_remaining := 0;
    ELSE
      v_slot := public._first_empty_slot(v_user_id, 'vault', 0);
      IF v_slot IS NOT NULL THEN
        INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
        VALUES (v_user_id, 'vault', 0, v_slot, p_item_id, p_quantity);
        v_inserted := p_quantity;
        v_remaining := 0;
      END IF;
    END IF;
  END IF;

  -- If anything was inserted, audit it.
  IF v_inserted > 0 THEN
    PERFORM _log_item_history(
      v_user_id, 'grant', p_item_id, v_item_key, v_inserted,
      NULL,
      jsonb_build_object('kind', p_region, 'overflow_to_qs', v_overflow),
      p_client_request_id, NULL
    );
  END IF;

  -- If NOTHING could be inserted (all regions full), REFUSE so the
  -- caller can show a "no space" message instead of silently dropping
  -- the item.
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'No empty slots in % (and QS overflow region also full); item refused', p_region
      USING ERRCODE = '23514', HINT = 'Vault some items to free space.';
  END IF;

  RETURN json_build_object(
    'replayed', false,
    'granted', v_inserted,
    'refused', v_remaining,
    'overflow_to_qs', v_overflow
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- Rewrite the grant_inventory_row compat shim to use the new
-- capacity-aware grant_slot for items. Blocks + seeds unchanged.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_inventory_row(
  p_item_type         TEXT,
  p_item_id           UUID,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_new   BOOLEAN;
  v_item_key TEXT;
  v_existing RECORD;
  v_rows     JSONB;
  v_lock_key TEXT;
  v_grant    JSON;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_item_type IS NULL OR p_item_type = '' THEN
    RAISE EXCEPTION 'item_type required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'replayed', true);
  END IF;

  IF p_item_type = 'item' THEN
    -- Route to capacity-aware grant_slot. Use a NEW request_id for
    -- the inner call so check_and_record_request inside grant_slot
    -- doesn't see ours as a replay (it's a different RPC frame).
    BEGIN
      v_grant := public.grant_slot('inventory', p_item_id, p_quantity,
        gen_random_uuid());
    EXCEPTION WHEN SQLSTATE '23514' THEN
      -- Capacity refused. Propagate to caller.
      RAISE;
    END;
    -- Return inserted rows in legacy shape.
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'item_type', 'item',
      'item_id', s.item_id,
      'quantity', 1,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    )) INTO v_rows
      FROM user_slots s
     WHERE s.user_id = v_user_id AND s.item_id = p_item_id
       AND s.region IN ('inventory', 'quick_select');
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', false);

  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

  ELSE
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
    v_lock_key := v_user_id::text || '|stk|' || p_item_type || '|NULL';
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
    SELECT * INTO v_existing FROM user_inventory
     WHERE user_id = v_user_id AND item_type = p_item_type AND item_id IS NULL
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
         WHERE id = v_existing.id RETURNING *
      ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, NULL, p_quantity) RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;
