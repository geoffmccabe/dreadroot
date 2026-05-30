-- Phase D-admin — Cross-user inventory grants for admin actions.
--
-- The only legitimate non-self inventory writes today are:
--   • admin inspector deletes someone's block → return to owner
--   • admin chops someone's tree → return seed to tree owner
-- Both happen rarely and only from admin-gated UI. Until L2 DO lands,
-- this RPC handles them through one server-side path:
--   admin_grant_inventory_row(target_user_id, item_type, item_id,
--                              quantity, client_request_id)
--
-- Authorization: caller must hold the 'admin' app_role. Same item-type
-- branches and stackable rules as grant_inventory_row.
--
-- NOTE: Regular player-on-player block mining (one user mining another
-- user's placed block, value returned to placer) is NOT covered here.
-- That path is non-admin and needs a future `mine_block` RPC that does
-- the placed_block DELETE + owner credit atomically. Tracked in the
-- D8 RLS lockdown pre-check.

CREATE OR REPLACE FUNCTION public.admin_grant_inventory_row(
  p_target_user_id    UUID,
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
  v_caller_id     UUID := auth.uid();
  v_is_new        BOOLEAN;
  v_item_key      TEXT;
  v_non_stackable BOOLEAN := false;
  v_rows          JSONB;
BEGIN
  -- ── Auth + caller must be admin ──
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  -- Either 'admin' or 'superadmin' is acceptable. has_role is strict
  -- equality, so we OR them explicitly (no built-in role hierarchy).
  IF NOT (has_role(v_caller_id, 'admin'::app_role)
          OR has_role(v_caller_id, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- ── Param validation ──
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id required' USING ERRCODE = '22023';
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

  -- ── Replay protection (request_id keyed on CALLER, not recipient) ──
  v_is_new := check_and_record_request(p_client_request_id, v_caller_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(i.*))
      INTO v_rows
      FROM user_inventory i
     WHERE i.user_id = p_target_user_id
       AND i.item_type = p_item_type
       AND (i.item_id = p_item_id OR (i.item_id IS NULL AND p_item_id IS NULL));
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  -- ── Type-specific validation, mirroring grant_inventory_row ──
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
  ELSE
    IF p_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'item_id must be NULL for block grants' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM blocks WHERE key = p_item_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block key % not found', p_item_type USING ERRCODE = '23503';
    END IF;
  END IF;

  -- ── Apply the grant on the TARGET user's inventory ──
  IF v_non_stackable THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      SELECT p_target_user_id, p_item_type, p_item_id, 1
        FROM generate_series(1, p_quantity)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Stackable. Advisory lock scoped to TARGET user prevents duplicate
    -- stackable rows under concurrent admin grants.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        p_target_user_id::text || '|' || p_item_type || '|' || COALESCE(p_item_id::text, ''),
        0
      )
    );

    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity + p_quantity, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = p_target_user_id
            AND item_type = p_item_type
            AND (item_id = p_item_id OR (item_id IS NULL AND p_item_id IS NULL))
          ORDER BY created_at ASC LIMIT 1
       )
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;

    IF v_rows IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (p_target_user_id, p_item_type, p_item_id, p_quantity)
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', '[]'::jsonb,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_grant_inventory_row(UUID, TEXT, UUID, INTEGER, UUID) TO authenticated;
