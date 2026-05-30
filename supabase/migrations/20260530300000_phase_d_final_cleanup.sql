-- Phase D-final-cleanup — consolidate legacy duplicate inventory rows,
-- add ensure_token_balance RPC for first-login balance creation.
--
-- After D-races shipped (the advisory-lock fix), new duplicate
-- stackable inventory rows can't form. But duplicates created BEFORE
-- that fix may still sit in the DB. The client used to consolidate
-- them on every load — once this one-shot migration runs, the client
-- consolidation code can be removed.
--
-- The ensure_token_balance RPC handles the first-login flow (user has
-- no balance row yet, we want to seed them 100 coins for the current
-- theme). Previously this was a direct insert in useUserData.

-- ---------------------------------------------------------------------
-- 1. One-shot duplicate consolidation.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_merged INTEGER;
BEGIN
  -- For each (user_id, item_type, item_id) with > 1 stackable row,
  -- merge all quantities into the oldest row and delete the rest.
  -- Only applies to rows with item_id NOT NULL (the original client
  -- consolidation logic only handled item_type='item' with item_id).
  WITH grouped AS (
    SELECT user_id, item_type, item_id,
           (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
           SUM(quantity) AS total_qty,
           COUNT(*) AS row_count
      FROM user_inventory
     WHERE item_type = 'item' AND item_id IS NOT NULL
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

  RAISE NOTICE 'Consolidated % duplicate inventory groups', v_merged;
END$$;

-- Also dedupe stackable BLOCK rows (item_type=blockKey, item_id IS NULL).
-- Same advisory-lock fix prevents new duplicates; this cleans up any
-- pre-existing ones.
DO $$
DECLARE
  v_merged INTEGER;
BEGIN
  WITH grouped AS (
    SELECT user_id, item_type,
           (array_agg(id ORDER BY created_at ASC))[1] AS keep_id,
           SUM(quantity) AS total_qty,
           COUNT(*) AS row_count
      FROM user_inventory
     WHERE item_id IS NULL
       AND item_type NOT LIKE 'seed_tier_%'
       AND item_type <> 'item'
     GROUP BY user_id, item_type
    HAVING COUNT(*) > 1
  ),
  deletes AS (
    DELETE FROM user_inventory ui
     USING grouped g
     WHERE ui.user_id = g.user_id
       AND ui.item_type = g.item_type
       AND ui.item_id IS NULL
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

  RAISE NOTICE 'Consolidated % duplicate block groups', v_merged;
END$$;

-- ---------------------------------------------------------------------
-- 2. ensure_token_balance — idempotent first-login balance creation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_token_balance(
  p_token_theme_id    UUID,
  p_starting_coins    INTEGER,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_new   BOOLEAN;
  v_existing RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token_theme_id IS NULL THEN
    RAISE EXCEPTION 'token_theme_id required' USING ERRCODE = '22023';
  END IF;
  IF p_starting_coins IS NULL OR p_starting_coins < 0 OR p_starting_coins > 1000000 THEN
    RAISE EXCEPTION 'Invalid starting_coins %', p_starting_coins USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  -- If a row already exists for (user, theme), just return it. This is
  -- idempotent on its own — replay protection mostly matters when the
  -- row genuinely needs to be created and the client double-fires.
  SELECT * INTO v_existing FROM user_token_balances
   WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id;
  IF FOUND THEN
    RETURN row_to_json(v_existing);
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    SELECT * INTO v_existing FROM user_token_balances
     WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id;
    RETURN row_to_json(v_existing);
  END IF;

  INSERT INTO user_token_balances (user_id, token_theme_id, coins)
  VALUES (v_user_id, p_token_theme_id, p_starting_coins)
  ON CONFLICT (user_id, token_theme_id) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing IS NULL THEN
    SELECT * INTO v_existing FROM user_token_balances
     WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id;
  END IF;

  RETURN row_to_json(v_existing);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_token_balance(UUID, INTEGER, UUID) TO authenticated;
