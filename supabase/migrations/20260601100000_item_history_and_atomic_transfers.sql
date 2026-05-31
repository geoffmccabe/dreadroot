-- Item-tracking foundation:
--   1. item_history (append-only audit table — every state change
--      of every item lands here so we can prove provenance,
--      detect dupe-glitches, and later migrate to a true ledger /
--      blockchain model without rewriting client code)
--   2. transfer_inventory_to_vault / transfer_vault_to_inventory /
--      transfer_vault_to_vault — atomic single-transaction moves
--      so a half-completed transfer can NEVER lose items (the
--      whole transfer succeeds or nothing happens).
--
-- Locations are JSONB blobs so we can extend (hotbar slots, world
-- drops, etc.) without altering the table schema:
--   { "kind": "inventory", "row_id": "<uuid>" }
--   { "kind": "vault",     "page": 0, "slot": 2 }
--   { "kind": "hotbar",    "slot": 1 }
--   { "kind": "world_drop","drop_id": "<uuid>" }

-- ---------------------------------------------------------------------
-- 1. item_history (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,  -- 'transfer', 'grant', 'consume', 'spawn_drop', 'pickup_drop', 'forge_burn', 'forge_create', 'admin_grant'
  item_id       UUID REFERENCES public.items(id) ON DELETE SET NULL,
  item_key      TEXT,           -- denormalized for block items where item_id is null
  quantity      INTEGER NOT NULL,
  from_location JSONB,
  to_location   JSONB,
  request_id    UUID,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_history_user_created
  ON public.item_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_history_item
  ON public.item_history(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_history_action
  ON public.item_history(action);

ALTER TABLE public.item_history ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own history. No INSERT policy — only
-- SECURITY DEFINER RPCs write here.
CREATE POLICY "Users read own item history"
  ON public.item_history FOR SELECT
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Internal helper: insert one history row. Called from the transfer
-- RPCs below. NOT exposed to clients.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._log_item_history(
  p_user_id       UUID,
  p_action        TEXT,
  p_item_id       UUID,
  p_item_key      TEXT,
  p_quantity      INTEGER,
  p_from_location JSONB,
  p_to_location   JSONB,
  p_request_id    UUID,
  p_metadata      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO item_history (
    user_id, action, item_id, item_key, quantity,
    from_location, to_location, request_id, metadata
  ) VALUES (
    p_user_id, p_action, p_item_id, p_item_key, p_quantity,
    p_from_location, p_to_location, p_request_id, p_metadata
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public._log_item_history FROM authenticated;

-- ---------------------------------------------------------------------
-- 2a. transfer_inventory_to_vault
-- Removes the named inventory rows AND inserts/stacks into the
-- target vault slot, in a single transaction. Verifies all rows
-- belong to the caller and all have the same item_id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_inventory_to_vault(
  p_inventory_row_ids UUID[],
  p_target_page       INTEGER,
  p_target_slot       INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_item_id    UUID;
  v_item_key   TEXT;
  v_total_qty  INTEGER := 0;
  v_existing   RECORD;
  v_vault_row  JSONB;
  v_deleted    JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_inventory_row_ids IS NULL OR array_length(p_inventory_row_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'inventory_row_ids required' USING ERRCODE = '22023';
  END IF;
  IF p_target_page IS NULL OR p_target_page < 0 OR p_target_page > 31 THEN
    RAISE EXCEPTION 'Invalid page %', p_target_page USING ERRCODE = '22023';
  END IF;
  IF p_target_slot IS NULL OR p_target_slot < 0 OR p_target_slot > 255 THEN
    RAISE EXCEPTION 'Invalid slot %', p_target_slot USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true, 'rows', '[]'::jsonb);
  END IF;

  -- Lock + verify all inventory rows. Must all belong to caller,
  -- all be item_type='item', all have the same item_id.
  WITH locked AS (
    SELECT id, item_id, quantity
      FROM user_inventory
     WHERE id = ANY(p_inventory_row_ids)
       AND user_id = v_user_id
       AND item_type = 'item'
       AND item_id IS NOT NULL
       FOR UPDATE
  )
  SELECT MIN(item_id), SUM(quantity), COUNT(*) FILTER (WHERE TRUE)
    INTO v_item_id, v_total_qty, v_deleted
    FROM locked;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'No matching inventory rows' USING ERRCODE = '23503';
  END IF;
  -- Verify all rows have the same item_id (no mixed transfer).
  PERFORM 1 FROM user_inventory
    WHERE id = ANY(p_inventory_row_ids)
      AND user_id = v_user_id
      AND (item_id <> v_item_id OR item_id IS NULL);
  IF FOUND THEN
    RAISE EXCEPTION 'All inventory rows must share the same item_id' USING ERRCODE = '22023';
  END IF;
  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Total quantity is zero' USING ERRCODE = '22023';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;

  -- Stack-or-fill vault slot. Same logic as vault_set_slot.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_target_page::text || '|' || p_target_slot::text, 0)
  );
  SELECT * INTO v_existing FROM user_vault
   WHERE user_id = v_user_id AND page = p_target_page AND slot = p_target_slot
   FOR UPDATE;

  IF FOUND AND v_existing.item_id = v_item_id THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + v_total_qty
       WHERE id = v_existing.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_vault_row FROM updated;
  ELSIF FOUND THEN
    -- Slot already has a different item — refuse rather than overwrite.
    RAISE EXCEPTION 'Target vault slot occupied by a different item' USING ERRCODE = '23505';
  ELSE
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_target_page, p_target_slot, v_item_id, v_total_qty)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_vault_row FROM inserted;
  END IF;

  -- Remove the inventory rows.
  DELETE FROM user_inventory
   WHERE id = ANY(p_inventory_row_ids) AND user_id = v_user_id;

  -- Audit row.
  PERFORM _log_item_history(
    v_user_id,
    'transfer',
    v_item_id,
    v_item_key,
    v_total_qty,
    jsonb_build_object('kind', 'inventory', 'row_ids', to_jsonb(p_inventory_row_ids)),
    jsonb_build_object('kind', 'vault', 'page', p_target_page, 'slot', p_target_slot),
    p_client_request_id,
    NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'vault_row', v_vault_row,
    'removed_inventory_row_ids', to_jsonb(p_inventory_row_ids),
    'item_id', v_item_id,
    'quantity', v_total_qty
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_to_vault(UUID[], INTEGER, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2b. transfer_vault_to_inventory
-- Decrements (or deletes) source vault slot AND adds matching qty
-- to inventory (stackable: increment existing row; non-stack: 1 row
-- per unit). Single transaction.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_vault_to_inventory(
  p_source_page       INTEGER,
  p_source_slot       INTEGER,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_vault_row      RECORD;
  v_item_id        UUID;
  v_item_key       TEXT;
  v_non_stackable  BOOLEAN := false;
  v_inv_rows       JSONB;
  v_remaining      INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  -- Lock the source vault slot.
  SELECT * INTO v_vault_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_source_page AND slot = p_source_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source vault slot empty' USING ERRCODE = '23503';
  END IF;
  IF v_vault_row.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity: have %, need %', v_vault_row.quantity, p_quantity USING ERRCODE = '23514';
  END IF;

  v_item_id := v_vault_row.item_id;
  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Source item % not found in items table', v_item_id USING ERRCODE = '23503';
  END IF;
  v_non_stackable := v_item_key = 'health_potion'
    OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
    OR v_item_key = 'diamond'
    OR v_item_key LIKE 'shpider_egg_t%'
    OR v_item_key = 'flame_glove'
    OR v_item_key = 'pistol';

  -- Decrement / delete vault slot.
  IF v_vault_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_vault_row.id;
    v_remaining := 0;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity
     WHERE id = v_vault_row.id
     RETURNING quantity INTO v_remaining;
  END IF;

  -- Insert inventory rows.
  IF v_non_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, 'item', v_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;
  ELSE
    -- Stack onto existing inventory row of the same item, or insert one.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_user_id::text || '|item|' || v_item_id::text, 0)
    );
    WITH updated AS (
      UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id AND item_type = 'item' AND item_id = v_item_id
          ORDER BY created_at ASC LIMIT 1
       ) RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_inv_rows FROM updated;
    IF v_inv_rows IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, 'item', v_item_id, p_quantity)
        RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;
    END IF;
  END IF;

  -- Audit.
  PERFORM _log_item_history(
    v_user_id,
    'transfer',
    v_item_id,
    v_item_key,
    p_quantity,
    jsonb_build_object('kind', 'vault', 'page', p_source_page, 'slot', p_source_slot),
    jsonb_build_object('kind', 'inventory'),
    p_client_request_id,
    NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'inventory_rows', v_inv_rows,
    'vault_remaining', v_remaining,
    'item_id', v_item_id,
    'quantity', p_quantity
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_vault_to_inventory(INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2c. transfer_vault_to_vault
-- Move quantity from one vault slot to another (any page). Single
-- transaction. Refuses to overwrite a different item already in the
-- target slot — caller picks a different target.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_vault_to_vault(
  p_src_page          INTEGER,
  p_src_slot          INTEGER,
  p_dst_page          INTEGER,
  p_dst_slot          INTEGER,
  p_quantity          INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_is_new     BOOLEAN;
  v_src_row    RECORD;
  v_dst_row    RECORD;
  v_item_id    UUID;
  v_item_key   TEXT;
  v_dst_jsonb  JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Invalid quantity %', p_quantity USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;
  IF p_src_page = p_dst_page AND p_src_slot = p_dst_slot THEN
    RAISE EXCEPTION 'Source and destination must differ' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('replayed', true);
  END IF;

  -- Lock source.
  SELECT * INTO v_src_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_src_page AND slot = p_src_slot FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source slot empty' USING ERRCODE = '23503'; END IF;
  IF v_src_row.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity in source' USING ERRCODE = '23514';
  END IF;
  v_item_id := v_src_row.item_id;

  -- Lock destination.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|v|' || p_dst_page::text || '|' || p_dst_slot::text, 0)
  );
  SELECT * INTO v_dst_row FROM user_vault
   WHERE user_id = v_user_id AND page = p_dst_page AND slot = p_dst_slot FOR UPDATE;
  IF FOUND AND v_dst_row.item_id <> v_item_id THEN
    RAISE EXCEPTION 'Destination occupied by a different item' USING ERRCODE = '23505';
  END IF;

  -- Decrement / delete source.
  IF v_src_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_src_row.id;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity WHERE id = v_src_row.id;
  END IF;

  -- Stack or create destination.
  IF FOUND AND v_dst_row.id IS NOT NULL THEN
    WITH updated AS (
      UPDATE user_vault SET quantity = quantity + p_quantity WHERE id = v_dst_row.id RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_dst_jsonb FROM updated;
  ELSE
    WITH inserted AS (
      INSERT INTO user_vault (user_id, page, slot, item_id, quantity)
      VALUES (v_user_id, p_dst_page, p_dst_slot, v_item_id, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_dst_jsonb FROM inserted;
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_item_id;
  PERFORM _log_item_history(
    v_user_id, 'transfer', v_item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', 'vault', 'page', p_src_page, 'slot', p_src_slot),
    jsonb_build_object('kind', 'vault', 'page', p_dst_page, 'slot', p_dst_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'destination_row', v_dst_jsonb,
    'item_id', v_item_id,
    'quantity', p_quantity
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_vault_to_vault(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, UUID) TO authenticated;
