-- v4.11.0 — Unified user_slots table.
--
-- Replaces the three-table sprawl (user_inventory items + user_equipped_items
-- + user_vault) with one authoritative table addressed by
-- (user_id, region, page, slot). Items in inv/QS have quantity=1
-- enforced by CHECK; vault items can stack. Blocks and seeds keep
-- living in user_inventory (different concept, item_id IS NULL or
-- seed_definitions FK).
--
-- ONE table. ONE realtime sub. ONE transfer RPC. Read-side becomes
-- a single source of truth so realtime drift can't leave state stale.

-- ────────────────────────────────────────────────────────────────────
-- 1. The unified table
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_slots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  region      TEXT NOT NULL CHECK (region IN ('inventory', 'quick_select', 'vault')),
  page        INTEGER NOT NULL DEFAULT 0 CHECK (page >= 0 AND page <= 31),
  slot        INTEGER NOT NULL CHECK (slot >= 0 AND slot <= 255),
  item_id     UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 10000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, region, page, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_slots_user_region ON public.user_slots(user_id, region);
CREATE INDEX IF NOT EXISTS idx_user_slots_item ON public.user_slots(item_id);

ALTER TABLE public.user_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own slots" ON public.user_slots
  FOR SELECT USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER RPCs write.

-- inv + quick_select rows must have quantity=1 (each unit is its own slot).
-- vault rows can stack.
CREATE OR REPLACE FUNCTION public.enforce_slot_quantity_by_region()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.region IN ('inventory', 'quick_select') AND NEW.quantity <> 1 THEN
    RAISE EXCEPTION
      'user_slots region=% rows must have quantity=1 (got %)', NEW.region, NEW.quantity
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_slots_qty_trigger ON public.user_slots;
CREATE TRIGGER user_slots_qty_trigger
  BEFORE INSERT OR UPDATE ON public.user_slots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_slot_quantity_by_region();

-- Realtime publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'user_slots'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_slots';
  END IF;
END$$;
ALTER TABLE public.user_slots REPLICA IDENTITY FULL;

-- ────────────────────────────────────────────────────────────────────
-- 2. One-shot data migration from the 3 legacy tables
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_inv INT := 0;
  v_eq  INT := 0;
  v_v   INT := 0;
BEGIN
  -- Inventory items → user_slots region='inventory'. Cap at slot 17
  -- (18 slots total). Items past index 18 per user are excess from
  -- the earlier "invisible inventory" bug — drop them rather than
  -- pollute the vault. (They were never visible or usable anyway.)
  WITH numbered AS (
    SELECT id, user_id, item_id, created_at,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) - 1 AS idx
      FROM user_inventory
     WHERE item_type = 'item' AND item_id IS NOT NULL
  ),
  inserted AS (
    INSERT INTO user_slots (id, user_id, region, page, slot, item_id, quantity, created_at, updated_at)
    SELECT id, user_id, 'inventory', 0, idx, item_id, 1, created_at, created_at
      FROM numbered
     WHERE idx < 18
    ON CONFLICT (user_id, region, page, slot) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inv FROM inserted;

  -- Equipped items → user_slots region='quick_select'. Parse hotbar_N.
  WITH parsed AS (
    SELECT id, user_id, item_id, equipped_at,
           NULLIF(regexp_replace(slot_type, '^hotbar_', ''), slot_type)::INT AS slot_idx
      FROM user_equipped_items
     WHERE slot_type LIKE 'hotbar_%'
  ),
  inserted AS (
    INSERT INTO user_slots (id, user_id, region, page, slot, item_id, quantity, created_at, updated_at)
    SELECT id, user_id, 'quick_select', 0, slot_idx, item_id, 1, equipped_at, equipped_at
      FROM parsed
     WHERE slot_idx IS NOT NULL
    ON CONFLICT (user_id, region, page, slot) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_eq FROM inserted;

  -- Vault items → user_slots region='vault'. Same page/slot.
  WITH inserted AS (
    INSERT INTO user_slots (id, user_id, region, page, slot, item_id, quantity, created_at, updated_at)
    SELECT id, user_id, 'vault', page, slot, item_id, quantity, created_at, updated_at
      FROM user_vault
    ON CONFLICT (user_id, region, page, slot) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_v FROM inserted;

  RAISE NOTICE 'Migrated to user_slots: % inv items + % equipped + % vault', v_inv, v_eq, v_v;
END$$;

-- Delete migrated rows from the legacy tables so we don't have
-- duplicate state. user_inventory keeps blocks (item_id IS NULL) and
-- seeds (item_type LIKE 'seed_tier_%') — those still live there.
DELETE FROM user_inventory WHERE item_type = 'item' AND item_id IS NOT NULL;
DELETE FROM user_equipped_items WHERE slot_type LIKE 'hotbar_%';
DELETE FROM user_vault;

-- ────────────────────────────────────────────────────────────────────
-- 3. ONE transfer RPC.
--
-- transfer_slot moves items between any two slots in any regions.
-- Stacking rules + region-specific constraints live entirely inside.
--
-- Cases handled:
--   inv/qs → inv/qs : qty must be 1, destination empty (else swap or refuse)
--   inv/qs → vault  : qty must be 1, vault stacks if same item, else refuse/new
--   vault  → inv/qs : qty must be 1, destination empty (else refuse for now)
--   vault  → vault  : any qty, stack if same item, refuse if different
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_slot(
  p_from_region       TEXT,
  p_from_page         INTEGER,
  p_from_slot         INTEGER,
  p_to_region         TEXT,
  p_to_page           INTEGER,
  p_to_slot           INTEGER,
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
  v_src       RECORD;
  v_dst       RECORD;
  v_item_key  TEXT;
  v_same_slot BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_from_region NOT IN ('inventory', 'quick_select', 'vault')
     OR p_to_region NOT IN ('inventory', 'quick_select', 'vault') THEN
    RAISE EXCEPTION 'Invalid region' USING ERRCODE = '22023';
  END IF;
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

  v_same_slot := (p_from_region = p_to_region
                  AND p_from_page = p_to_page
                  AND p_from_slot = p_to_slot);
  IF v_same_slot THEN
    RETURN json_build_object('replayed', false, 'noop', true);
  END IF;

  -- Lock src + dst with advisory locks (order by region/page/slot to
  -- avoid deadlocks).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|s|' || p_from_region || '|' || p_from_page::text || '|' || p_from_slot::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|s|' || p_to_region || '|' || p_to_page::text || '|' || p_to_slot::text, 0)
  );

  -- Source must exist + have enough qty.
  SELECT * INTO v_src FROM user_slots
   WHERE user_id = v_user_id AND region = p_from_region
     AND page = p_from_page AND slot = p_from_slot
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source slot empty (% page=% slot=%)', p_from_region, p_from_page, p_from_slot
      USING ERRCODE = '23503';
  END IF;
  IF v_src.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity in source' USING ERRCODE = '23514';
  END IF;

  -- inv/qs source means moving the entire slot (qty=1 always).
  IF p_from_region IN ('inventory', 'quick_select') AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'inv/qs slots are qty=1' USING ERRCODE = '22023';
  END IF;
  -- inv/qs destination same.
  IF p_to_region IN ('inventory', 'quick_select') AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'inv/qs destination requires qty=1' USING ERRCODE = '22023';
  END IF;

  -- Target slot — empty / same / different.
  SELECT * INTO v_dst FROM user_slots
   WHERE user_id = v_user_id AND region = p_to_region
     AND page = p_to_page AND slot = p_to_slot
   FOR UPDATE;

  IF FOUND THEN
    IF p_to_region IN ('inventory', 'quick_select') THEN
      -- Destination occupied; inv/qs don't merge.
      RAISE EXCEPTION 'Destination slot occupied (inv/qs do not stack)' USING ERRCODE = '23505';
    ELSIF v_dst.item_id <> v_src.item_id THEN
      RAISE EXCEPTION 'Destination has a different item' USING ERRCODE = '23505';
    ELSE
      -- Vault same-item merge.
      UPDATE user_slots SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = v_dst.id;
    END IF;
  ELSE
    -- Insert new destination row.
    INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
    VALUES (v_user_id, p_to_region, p_to_page, p_to_slot, v_src.item_id, p_quantity);
  END IF;

  -- Decrement / delete source.
  IF v_src.quantity = p_quantity THEN
    DELETE FROM user_slots WHERE id = v_src.id;
  ELSE
    UPDATE user_slots SET quantity = quantity - p_quantity, updated_at = NOW()
     WHERE id = v_src.id;
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_src.item_id;
  PERFORM _log_item_history(
    v_user_id, 'transfer', v_src.item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', p_from_region, 'page', p_from_page, 'slot', p_from_slot),
    jsonb_build_object('kind', p_to_region, 'page', p_to_page, 'slot', p_to_slot),
    p_client_request_id, NULL
  );

  RETURN json_build_object(
    'replayed', false,
    'item_id', v_src.item_id,
    'quantity', p_quantity
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_slot(TEXT, INTEGER, INTEGER, TEXT, INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4. grant_slot — place an item in the first empty slot of a region.
-- Replaces grant_inventory_row for items. (Blocks + seeds still use
-- the old RPC since they live in user_inventory.)
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
  v_user_id  UUID := auth.uid();
  v_is_new   BOOLEAN;
  v_slot     INTEGER;
  v_page     INTEGER := 0;
  v_item_key TEXT;
  v_remaining INTEGER;
  v_inserted INTEGER := 0;
  v_existing RECORD;
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
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_remaining := p_quantity;
  IF p_region IN ('inventory', 'quick_select') THEN
    -- Each unit gets its own slot.
    WHILE v_remaining > 0 LOOP
      SELECT COALESCE(MIN(s), 0) INTO v_slot
        FROM generate_series(0,
          CASE WHEN p_region = 'inventory' THEN 255 ELSE 9 END) AS s
       WHERE NOT EXISTS (
         SELECT 1 FROM user_slots
          WHERE user_id = v_user_id AND region = p_region AND page = 0 AND slot = s
       );
      IF v_slot IS NULL THEN
        EXIT; -- region full; remaining units stay un-granted
      END IF;
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (v_user_id, p_region, 0, v_slot, p_item_id, 1);
      v_inserted := v_inserted + 1;
      v_remaining := v_remaining - 1;
    END LOOP;
  ELSE
    -- Vault: try to stack on existing same-item slot, else first empty.
    SELECT * INTO v_existing FROM user_slots
     WHERE user_id = v_user_id AND region = 'vault' AND item_id = p_item_id
     ORDER BY page, slot LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE user_slots SET quantity = quantity + p_quantity WHERE id = v_existing.id;
      v_inserted := p_quantity;
    ELSE
      -- First empty vault slot.
      SELECT COALESCE(MIN(s), 0) INTO v_slot
        FROM generate_series(0, 255) AS s
       WHERE NOT EXISTS (
         SELECT 1 FROM user_slots
          WHERE user_id = v_user_id AND region = 'vault' AND page = 0 AND slot = s
       );
      IF v_slot IS NOT NULL THEN
        INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
        VALUES (v_user_id, 'vault', 0, v_slot, p_item_id, p_quantity);
        v_inserted := p_quantity;
      END IF;
    END IF;
  END IF;

  PERFORM _log_item_history(
    v_user_id, 'grant', p_item_id, v_item_key, v_inserted,
    NULL,
    jsonb_build_object('kind', p_region),
    p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false, 'granted', v_inserted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.grant_slot(TEXT, UUID, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 5. consume_slot — destroy a slot's contents (use grenade, drink potion).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_slot(
  p_region            TEXT,
  p_page              INTEGER,
  p_slot              INTEGER,
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
  v_slot     RECORD;
  v_item_key TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN RETURN json_build_object('replayed', true); END IF;

  SELECT * INTO v_slot FROM user_slots
   WHERE user_id = v_user_id AND region = p_region
     AND page = p_page AND slot = p_slot FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot empty' USING ERRCODE = '23503';
  END IF;
  IF v_slot.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient quantity' USING ERRCODE = '23514';
  END IF;

  IF v_slot.quantity = p_quantity THEN
    DELETE FROM user_slots WHERE id = v_slot.id;
  ELSE
    UPDATE user_slots SET quantity = quantity - p_quantity WHERE id = v_slot.id;
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_slot.item_id;
  PERFORM _log_item_history(
    v_user_id, 'consume', v_slot.item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', p_region, 'page', p_page, 'slot', p_slot),
    NULL, p_client_request_id, NULL
  );

  RETURN json_build_object('replayed', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_slot(TEXT, INTEGER, INTEGER, INTEGER, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 6. Compatibility shims for the legacy item RPCs.
-- Items now live in user_slots, but many callers (pickup_world_drop,
-- forge_items, admin grants, etc.) still call grant_inventory_row /
-- consume_inventory_target. Route the ITEM cases to user_slots so
-- existing callers continue working without code changes. Blocks
-- and seeds still use user_inventory.
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
  v_slot     INTEGER;
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
    -- Route items to user_slots. Find empty inv slots, fill them.
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for item_type=item' USING ERRCODE = '22023';
    END IF;
    SELECT key INTO v_item_key FROM items WHERE id = p_item_id;
    IF v_item_key IS NULL THEN
      RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    FOR i IN 1..p_quantity LOOP
      SELECT COALESCE(MIN(s), 0) INTO v_slot
        FROM generate_series(0, 255) AS s
       WHERE NOT EXISTS (
         SELECT 1 FROM user_slots
          WHERE user_id = v_user_id AND region = 'inventory' AND page = 0 AND slot = s
       );
      IF v_slot IS NULL THEN EXIT; END IF;
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (v_user_id, 'inventory', 0, v_slot, p_item_id, 1);
    END LOOP;
    -- Return the rows in the legacy shape so callers don't break.
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
     WHERE s.user_id = v_user_id AND s.region = 'inventory' AND s.item_id = p_item_id;
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', false);

  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    -- Per-unit for seeds (unchanged).
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

  ELSE
    -- Block: stack-or-insert (unchanged).
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

-- delete_inventory_row: items now live in user_slots. Try both tables.
CREATE OR REPLACE FUNCTION public.delete_inventory_row(
  p_row_id            UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_deleted_id  UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_row_id IS NULL THEN
    RAISE EXCEPTION 'row_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  -- Try user_slots first (items).
  DELETE FROM user_slots
   WHERE id = p_row_id AND user_id = v_user_id
   RETURNING id INTO v_deleted_id;
  IF v_deleted_id IS NOT NULL THEN
    RETURN json_build_object(
      'rows', '[]'::jsonb,
      'deleted_row_ids', jsonb_build_array(v_deleted_id),
      'replayed', false);
  END IF;

  -- Fall back to user_inventory (blocks/seeds).
  DELETE FROM user_inventory
   WHERE id = p_row_id AND user_id = v_user_id
   RETURNING id INTO v_deleted_id;
  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Row % not found in any inventory table', p_row_id USING ERRCODE = '23503';
  END IF;

  RETURN json_build_object(
    'rows', '[]'::jsonb,
    'deleted_row_ids', jsonb_build_array(v_deleted_id),
    'replayed', false);
END;
$$;
