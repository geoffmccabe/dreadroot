-- Phase D7 — Currency (coins + points) write RPCs.
--
-- Three RPCs:
--   1. buy_block         — atomic spend coins + grant block (one txn)
--   2. grant_currency    — atomic add to user_token_balances
--   3. grant_points      — atomic add to total_points, recompute level
--
-- All follow the established pattern (auth.uid, replay protection,
-- standardized return shape {rows, deleted_row_ids, replayed}).
--
-- The race-safe spend pattern: UPDATE ... WHERE coins >= p_cost RETURNING.
-- If no row matches, the spend is rejected with 'Insufficient coins'.
-- Two concurrent buy attempts both see coins=N pre-update; only one's
-- UPDATE actually succeeds because the WHERE re-checks after locking.

-- ---------------------------------------------------------------------
-- Helper: level_for_points
-- Mirrors src/lib/levelSystem.ts:getLevelForPoints
-- Thresholds: L1=0, L2=100, L3=200, L4=400, ... L<N> = 100 * 2^(N-2).
-- Caps at level 30.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.level_for_points(p_points INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_level INTEGER := 1;
  v_threshold INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN 1; END IF;
  FOR v_level IN REVERSE 30..2 LOOP
    v_threshold := (100 * (2 ^ (v_level - 2)))::INTEGER;
    IF p_points >= v_threshold THEN RETURN v_level; END IF;
  END LOOP;
  RETURN 1;
END;
$$;

-- ---------------------------------------------------------------------
-- 1. buy_block — atomic spend + grant.
--
-- Steps inside one transaction:
--   a) Spend p_cost from user_token_balances (UPDATE WHERE coins >= cost)
--   b) Grant 1 block to user_inventory (using same advisory-lock pattern
--      as grant_inventory_row).
-- If either fails, the whole txn rolls back — coins are never lost.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_block(
  p_block_key         TEXT,
  p_cost              INTEGER,
  p_token_theme_id    UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_new_balance    INTEGER;
  v_rows           JSONB;
  v_inv_row        JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_block_key IS NULL OR p_block_key = '' THEN
    RAISE EXCEPTION 'block_key required' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 OR p_cost > 1000000 THEN
    RAISE EXCEPTION 'Invalid cost %', p_cost USING ERRCODE = '22023';
  END IF;
  IF p_token_theme_id IS NULL THEN
    RAISE EXCEPTION 'token_theme_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- Validate block key
  PERFORM 1 FROM blocks WHERE key = p_block_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block key % not found', p_block_key USING ERRCODE = '23503';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT jsonb_agg(row_to_json(i.*)) INTO v_rows FROM user_inventory i
     WHERE i.user_id = v_user_id AND i.item_type = p_block_key AND i.item_id IS NULL;
    RETURN json_build_object(
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'deleted_row_ids', '[]'::jsonb,
      'replayed', true);
  END IF;

  -- ── 1. Spend coins atomically ──
  UPDATE user_token_balances
     SET coins = coins - p_cost,
         updated_at = NOW()
   WHERE user_id = v_user_id
     AND token_theme_id = p_token_theme_id
     AND coins >= p_cost
   RETURNING coins INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient coins or balance not found' USING ERRCODE = '23514';
  END IF;

  -- ── 2. Grant the block (stackable, advisory-locked) ──
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|' || p_block_key || '|', 0)
  );

  WITH updated AS (
    UPDATE user_inventory
       SET quantity = quantity + 1, updated_at = NOW()
     WHERE id = (
       SELECT id FROM user_inventory
        WHERE user_id = v_user_id AND item_type = p_block_key AND item_id IS NULL
        ORDER BY created_at ASC LIMIT 1
     )
    RETURNING *
  )
  SELECT jsonb_agg(row_to_json(updated.*)) INTO v_inv_row FROM updated;

  IF v_inv_row IS NULL THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      VALUES (v_user_id, p_block_key, NULL, 1) RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_row FROM inserted;
  END IF;

  RETURN json_build_object(
    'rows', v_inv_row,
    'deleted_row_ids', '[]'::jsonb,
    'new_balance', v_new_balance,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_block(TEXT, INTEGER, UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. grant_currency — add coins to a token-theme balance.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_currency(
  p_token_theme_id    UUID,
  p_amount            INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_new_balance INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token_theme_id IS NULL THEN
    RAISE EXCEPTION 'token_theme_id required' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Invalid amount %', p_amount USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT coins INTO v_new_balance FROM user_token_balances
     WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id;
    RETURN json_build_object('new_balance', v_new_balance, 'replayed', true);
  END IF;

  UPDATE user_token_balances
     SET coins = coins + p_amount, updated_at = NOW()
   WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id
   RETURNING coins INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Balance row not found' USING ERRCODE = '23503';
  END IF;

  RETURN json_build_object('new_balance', v_new_balance, 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_currency(UUID, INTEGER, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. grant_points — atomic increment of total_points + recompute level.
--    Returns new total_points + new level + leveled_up flag.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_points(
  p_amount            INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_is_new      BOOLEAN;
  v_old_level   INTEGER;
  v_new_total   INTEGER;
  v_new_level   INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Invalid amount %', p_amount USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT total_points, current_level INTO v_new_total, v_new_level
      FROM user_profiles WHERE user_id = v_user_id;
    RETURN json_build_object(
      'new_total_points', v_new_total,
      'new_level', v_new_level,
      'leveled_up', false,
      'replayed', true);
  END IF;

  SELECT current_level INTO v_old_level FROM user_profiles WHERE user_id = v_user_id;
  v_old_level := COALESCE(v_old_level, 1);

  UPDATE user_profiles
     SET total_points = COALESCE(total_points, 0) + p_amount,
         updated_at = NOW()
   WHERE user_id = v_user_id
   RETURNING total_points INTO v_new_total;

  IF v_new_total IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '23503';
  END IF;

  v_new_level := level_for_points(v_new_total);

  IF v_new_level <> v_old_level THEN
    UPDATE user_profiles SET current_level = v_new_level WHERE user_id = v_user_id;
  END IF;

  RETURN json_build_object(
    'new_total_points', v_new_total,
    'new_level', v_new_level,
    'leveled_up', v_new_level > v_old_level,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_points(INTEGER, UUID) TO authenticated;
