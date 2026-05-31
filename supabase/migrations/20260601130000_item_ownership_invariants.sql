-- Item-ownership invariants. "Items are money" — the database must
-- guarantee that no code path, present or future, can mint items out
-- of thin air. Three layers:
--
--   1. Single source of truth: items.stackable column. The TS client
--      list and the per-RPC hardcoded lists were drifting; now both
--      query this column.
--   2. Server-side TRIGGER on user_inventory. Any INSERT that would
--      create a duplicate stackable row for the same (user, item_id)
--      is rejected at the storage layer — even raw SQL, even a future
--      buggy RPC, even an admin Studio query.
--   3. One-shot CONSOLIDATION of existing duplicate stackable rows
--      so the trigger can be installed without breaking historical
--      data. (Previous consolidation in 20260530300000 ran before the
--      pistol-stackability hotfix; this re-consolidates the dupes
--      that accumulated since.)
--
-- After this migration, the only legitimate way to grow a stackable
-- inventory row is via grant_inventory_row or transfer_*, which
-- correctly UPDATE the existing row.

-- ────────────────────────────────────────────────────────────────────
-- 1. items.stackable column
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS stackable BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed the canonical non-stackable keys. Mirrors FortressHUD's
-- isNonStackableKey + useUserData.isNonStackableKey. After this point
-- those TS lists become display-only — the DB is authoritative.
UPDATE public.items
   SET stackable = FALSE
 WHERE key IN ('health_potion', 'grenade', 'diamond')
    OR key LIKE 'grenade_t%'
    OR key LIKE 'shpider_egg_t%';

-- ────────────────────────────────────────────────────────────────────
-- 2. One-shot re-consolidation of duplicate stackable rows.
-- Must run BEFORE the uniqueness trigger or the trigger creation will
-- effectively be moot (existing dupes wouldn't violate the new rule
-- since the trigger only fires on INSERT, but the user's display
-- would still show the inflated sum).
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_merged INTEGER;
BEGIN
  WITH stackable_items AS (
    SELECT id FROM items WHERE stackable
  ),
  grouped AS (
    SELECT user_id, item_type, item_id,
           (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
           SUM(quantity) AS total_qty,
           COUNT(*) AS row_count
      FROM user_inventory
     WHERE item_type = 'item'
       AND item_id IS NOT NULL
       AND item_id IN (SELECT id FROM stackable_items)
     GROUP BY user_id, item_type, item_id
    HAVING COUNT(*) > 1
  ),
  deletes AS (
    DELETE FROM user_inventory ui
     USING grouped g
     WHERE ui.user_id = g.user_id
       AND ui.item_type = g.item_type
       AND ui.item_id = g.item_id
       AND ui.id <> g.keep_id
    RETURNING ui.id
  ),
  updates AS (
    UPDATE user_inventory ui
       SET quantity = g.total_qty,
           updated_at = NOW()
      FROM grouped g
     WHERE ui.id = g.keep_id
    RETURNING ui.id
  )
  SELECT COUNT(*) INTO v_merged FROM updates;
  RAISE NOTICE 'Re-consolidated % stackable item groups', v_merged;
END$$;

-- Also re-dedupe stackable BLOCK rows (item_type=blockKey, item_id IS NULL)
-- and SEED rows (item_type=seed_tier_N) for completeness — both are
-- always stackable.
DO $$
DECLARE
  v_merged INTEGER;
BEGIN
  WITH grouped AS (
    SELECT user_id, item_type, item_id,
           (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
           SUM(quantity) AS total_qty
      FROM user_inventory
     WHERE (item_id IS NULL AND item_type <> 'item')
        OR item_type LIKE 'seed_tier_%'
     GROUP BY user_id, item_type, item_id
    HAVING COUNT(*) > 1
  ),
  deletes AS (
    DELETE FROM user_inventory ui
     USING grouped g
     WHERE ui.user_id = g.user_id
       AND ui.item_type = g.item_type
       AND (ui.item_id = g.item_id OR (ui.item_id IS NULL AND g.item_id IS NULL))
       AND ui.id <> g.keep_id
    RETURNING ui.id
  ),
  updates AS (
    UPDATE user_inventory ui
       SET quantity = g.total_qty,
           updated_at = NOW()
      FROM grouped g
     WHERE ui.id = g.keep_id
    RETURNING ui.id
  )
  SELECT COUNT(*) INTO v_merged FROM updates;
  RAISE NOTICE 'Re-consolidated % block/seed groups', v_merged;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. TRIGGER enforcing "at most one row per (user, item identity)"
-- for stackable inventory entries. Three cases:
--   * item_type='item' AND items.stackable=TRUE  → unique on (user, item_id)
--   * item_type LIKE 'seed_tier_%'                → unique on (user, type, item_id)
--   * item_type=blockKey AND item_id IS NULL      → unique on (user, type)
-- Non-stackable items (health_potion, grenade*, diamond, shpider_egg*)
-- are exempt — each row IS a slot.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_inventory_stackable_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_stackable BOOLEAN;
  v_dup_count INT;
BEGIN
  IF NEW.item_type = 'item' THEN
    IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
    SELECT stackable INTO v_stackable FROM items WHERE id = NEW.item_id;
    -- Unknown item_id: let other constraints handle (FK should catch).
    IF v_stackable IS NULL THEN RETURN NEW; END IF;
    -- Non-stackable item: each row is its own slot. Skip.
    IF NOT v_stackable THEN RETURN NEW; END IF;
    SELECT COUNT(*) INTO v_dup_count FROM user_inventory
     WHERE user_id = NEW.user_id
       AND item_type = 'item'
       AND item_id = NEW.item_id
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION
        'Duplicate stackable inventory row blocked by invariant (user=%, item=%) — aggregate via grant_inventory_row instead',
        NEW.user_id, NEW.item_id
        USING ERRCODE = '23505';
    END IF;
  ELSIF NEW.item_type LIKE 'seed_tier_%' THEN
    IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
    SELECT COUNT(*) INTO v_dup_count FROM user_inventory
     WHERE user_id = NEW.user_id
       AND item_type = NEW.item_type
       AND item_id = NEW.item_id
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION
        'Duplicate seed row blocked by invariant (user=%, type=%, seed=%)',
        NEW.user_id, NEW.item_type, NEW.item_id
        USING ERRCODE = '23505';
    END IF;
  ELSE
    -- Block: item_type=blockKey, item_id IS NULL. Always stackable.
    IF NEW.item_id IS NOT NULL THEN RETURN NEW; END IF;
    SELECT COUNT(*) INTO v_dup_count FROM user_inventory
     WHERE user_id = NEW.user_id
       AND item_type = NEW.item_type
       AND item_id IS NULL
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION
        'Duplicate block row blocked by invariant (user=%, type=%)',
        NEW.user_id, NEW.item_type
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_inventory_stackable_unique_trigger ON public.user_inventory;
CREATE TRIGGER user_inventory_stackable_unique_trigger
  BEFORE INSERT ON public.user_inventory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_stackable_uniqueness();

-- ────────────────────────────────────────────────────────────────────
-- 4. Update transfer_vault_to_inventory and grant_inventory_row to
-- read items.stackable instead of the hardcoded key list. Removes
-- the last source of stackability drift between SQL and TS.
-- ────────────────────────────────────────────────────────────────────
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
  v_stackable      BOOLEAN;
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
    RETURN json_build_object('replayed', true,
      'inventory_rows', '[]'::jsonb,
      'vault_remaining', 0,
      'item_id', NULL, 'quantity', 0);
  END IF;

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
  SELECT key, stackable INTO v_item_key, v_stackable FROM items WHERE id = v_item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Source item % not found in items table', v_item_id USING ERRCODE = '23503';
  END IF;

  IF v_vault_row.quantity = p_quantity THEN
    DELETE FROM user_vault WHERE id = v_vault_row.id;
    v_remaining := 0;
  ELSE
    UPDATE user_vault SET quantity = quantity - p_quantity
     WHERE id = v_vault_row.id
     RETURNING quantity INTO v_remaining;
  END IF;

  IF NOT v_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, 'item', v_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_rows FROM inserted;
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_user_id::text || '|item|' || v_item_id::text, 0)
    );
    WITH updated AS (
      UPDATE user_inventory SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id AND item_type = 'item' AND item_id = v_item_id
          ORDER BY created_at ASC LIMIT 1
          FOR UPDATE
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

  PERFORM _log_item_history(
    v_user_id, 'transfer', v_item_id, v_item_key, p_quantity,
    jsonb_build_object('kind', 'vault', 'page', p_source_page, 'slot', p_source_slot),
    jsonb_build_object('kind', 'inventory'),
    p_client_request_id, NULL
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

-- grant_inventory_row — same change: read items.stackable instead of
-- the hardcoded key list.
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
  v_user_id       UUID := auth.uid();
  v_is_new        BOOLEAN;
  v_item_key      TEXT;
  v_stackable     BOOLEAN := true;
  v_existing      RECORD;
  v_rows          JSONB;
  v_lock_key      TEXT;
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
    SELECT jsonb_agg(row_to_json(i.*)) INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = v_user_id
       AND i.item_type = p_item_type
       AND (i.item_id = p_item_id OR (i.item_id IS NULL AND p_item_id IS NULL));
    RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'replayed', true);
  END IF;

  IF p_item_type = 'item' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for item_type=item' USING ERRCODE = '22023';
    END IF;
    SELECT key, stackable INTO v_item_key, v_stackable FROM items WHERE id = p_item_id;
    IF v_item_key IS NULL THEN
      RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
    END IF;
  ELSIF p_item_type LIKE 'seed_tier_%' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id required for seed' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM seed_definitions WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seed definition % not found', p_item_id USING ERRCODE = '23503';
    END IF;
    -- seeds always stack
  ELSE
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
    -- blocks always stack
  END IF;

  IF p_item_type = 'item' AND NOT v_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT v_user_id, p_item_type, p_item_id, 1 FROM generate_series(1, p_quantity)
      RETURNING *
    ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    v_lock_key := v_user_id::text || '|stk|' || p_item_type || '|' || COALESCE(p_item_id::text, 'NULL');
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

    SELECT * INTO v_existing
      FROM user_inventory
     WHERE user_id = v_user_id
       AND item_type = p_item_type
       AND (item_id = p_item_id OR (item_id IS NULL AND p_item_id IS NULL))
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      WITH updated AS (
        UPDATE user_inventory
           SET quantity = quantity + p_quantity, updated_at = NOW()
         WHERE id = v_existing.id RETURNING *
      ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;
    ELSE
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_item_type, p_item_id, p_quantity)
        RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object('rows', v_rows, 'replayed', false);
END;
$$;
