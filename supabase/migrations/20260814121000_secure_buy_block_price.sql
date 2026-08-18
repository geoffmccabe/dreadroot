-- SECURITY FIX (2026-Aug-14): buy_block trusted the CLIENT for the price.
-- It range-checked p_cost (0..1000000) but never compared it to the block's
-- real price, and 0 is a legal cost, so any authenticated user could buy any
-- block for nothing by calling the RPC directly.
--
-- Fix: the server looks up blocks.cost and debits THAT. p_cost stays in the
-- signature so the shipped client keeps working, but it is now advisory only.
-- Verified safe: blocks has 60 rows, cost is NOT NULL on all of them, range
-- 0..699 (some blocks are legitimately free).
--
-- Everything else in this function is unchanged from the live definition.

CREATE OR REPLACE FUNCTION public.buy_block(
  p_block_key text,
  p_cost integer,
  p_token_theme_id uuid,
  p_client_request_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DECLARE
    v_user_id UUID := auth.uid();
    v_is_new BOOLEAN; v_new_balance INTEGER; v_rows JSONB; v_inv_row JSONB;
    v_cost INTEGER;
  BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
    IF p_block_key IS NULL OR p_block_key = '' THEN RAISE EXCEPTION 'block_key required' USING ERRCODE = '22023'; END IF;
    IF p_token_theme_id IS NULL THEN RAISE EXCEPTION 'token_theme_id required' USING ERRCODE = '22023'; END IF;
    IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023'; END IF;

    -- AUTHORITATIVE PRICE: from the catalogue, never from the caller.
    SELECT cost INTO v_cost FROM blocks WHERE key = p_block_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'Block key % not found', p_block_key USING ERRCODE = '23503'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Block % has no valid price', p_block_key USING ERRCODE = '22023'; END IF;

    v_is_new := check_and_record_request(p_client_request_id, v_user_id);
    IF NOT v_is_new THEN
      SELECT jsonb_agg(row_to_json(i.*)) INTO v_rows FROM user_inventory i
       WHERE i.user_id = v_user_id AND i.item_type = p_block_key AND i.item_id IS NULL;
      RETURN json_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
    END IF;

    UPDATE user_token_balances SET coins = coins - v_cost, updated_at = NOW()
     WHERE user_id = v_user_id AND token_theme_id = p_token_theme_id AND coins >= v_cost
     RETURNING coins INTO v_new_balance;
    IF v_new_balance IS NULL THEN RAISE EXCEPTION 'Insufficient coins or balance not found' USING ERRCODE = '23514'; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || '|' || p_block_key || '|', 0));

    WITH updated AS (
      UPDATE user_inventory SET quantity = quantity + 1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id AND item_type = p_block_key AND item_id IS NULL
          ORDER BY created_at ASC LIMIT 1
       ) RETURNING *
    ) SELECT jsonb_agg(row_to_json(updated.*)) INTO v_inv_row FROM updated;

    IF v_inv_row IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, p_block_key, NULL, 1) RETURNING *
      ) SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_inv_row FROM inserted;
    END IF;

    RETURN json_build_object(
      'rows', v_inv_row, 'deleted_row_ids', '[]'::jsonb,
      'new_balance', v_new_balance, 'replayed', false);
  END;
  $function$;
