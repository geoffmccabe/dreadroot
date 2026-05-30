-- Phase D-drops — persistent world-drop items.
--
-- Today, weapons/grenades/etc. drop on enemy kill into client-only
-- memory (refresh = gone). This migration adds the world_drops table
-- and two RPCs so drops persist L1 (Supabase), survive refresh, and
-- can later be authoritatively managed by the L2 DO.
--
-- Visibility rule (enforced client-side, not server):
--   * For first 30s: only the killer sees the drop
--   * After 30s:     visible to everyone
--   * Pickup is always allowed regardless of visibility — non-killers
--     who happen to be in range during the window can "steal" it
--
-- Note: future shtickmen feature will delete world_drops within 3
-- blocks of a shtickman (passive cleanup, not pickup). See memory
-- project_dreadroot_shtickmen_item_sweep.

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.world_drops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  killer_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_x      REAL NOT NULL,
  position_y      REAL NOT NULL,
  position_z      REAL NOT NULL,
  dropped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_drops_dropped_at
  ON public.world_drops(dropped_at);
CREATE INDEX IF NOT EXISTS idx_world_drops_killer
  ON public.world_drops(killer_user_id);

-- Enable RLS: SELECT for any authenticated user (visibility filter is
-- client-side). INSERT/DELETE locked — must go through RPCs.
ALTER TABLE public.world_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read all world drops"
  ON public.world_drops FOR SELECT
  TO authenticated USING (true);

-- Realtime publication so clients can subscribe to inserts/deletes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'world_drops'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.world_drops;
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 2. spawn_world_drop — RPC to spawn a drop on enemy kill.
--    Caller becomes the killer (auth.uid()).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spawn_world_drop(
  p_item_id           UUID,
  p_position_x        REAL,
  p_position_y        REAL,
  p_position_z        REAL,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_new  BOOLEAN;
  v_row     RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    -- Replay: return any existing row created by this request_id, or
    -- empty if it doesn't exist. (We don't store request_id on the row
    -- so we can't fetch the original — empty is fine; client already
    -- has it via realtime.)
    RETURN json_build_object('row', null, 'replayed', true);
  END IF;

  INSERT INTO world_drops (item_id, killer_user_id, position_x, position_y, position_z)
  VALUES (p_item_id, v_user_id, p_position_x, p_position_y, p_position_z)
  RETURNING * INTO v_row;

  RETURN json_build_object('row', row_to_json(v_row), 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.spawn_world_drop(UUID, REAL, REAL, REAL, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. pickup_world_drop — atomic delete + inventory grant.
--    Anyone can pick up any drop (no exclusivity check on the server).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pickup_world_drop(
  p_drop_id           UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_is_new    BOOLEAN;
  v_drop      RECORD;
  v_item_key  TEXT;
  v_stack     BOOLEAN := false;
  v_rows      JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_drop_id IS NULL THEN
    RAISE EXCEPTION 'drop_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_world_drop_id', null, 'replayed', true);
  END IF;

  SELECT * INTO v_drop FROM world_drops WHERE id = p_drop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Drop % not found', p_drop_id USING ERRCODE = '23503';
  END IF;

  SELECT key INTO v_item_key FROM items WHERE id = v_drop.item_id;
  IF v_item_key IS NULL THEN
    RAISE EXCEPTION 'Item def missing for %', v_drop.item_id USING ERRCODE = '23503';
  END IF;

  -- Stackability mirrors grant_inventory_row.
  v_stack := NOT (
    v_item_key = 'health_potion'
    OR v_item_key = 'grenade' OR v_item_key LIKE 'grenade_t%'
    OR v_item_key = 'diamond'
    OR v_item_key LIKE 'shpider_egg_t%'
  );

  DELETE FROM world_drops WHERE id = p_drop_id;

  IF NOT v_stack THEN
    WITH inserted AS (
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      VALUES (v_user_id, 'item', v_drop.item_id, 1)
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
  ELSE
    -- Same advisory-lock-or-update pattern as grant_inventory_row to
    -- avoid duplicate stackable rows under concurrent pickups.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_user_id::text || '|item|' || v_drop.item_id::text, 0)
    );

    WITH updated AS (
      UPDATE user_inventory
         SET quantity = quantity + 1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_inventory
          WHERE user_id = v_user_id
            AND item_type = 'item'
            AND item_id = v_drop.item_id
          ORDER BY created_at ASC LIMIT 1
       )
      RETURNING *
    )
    SELECT jsonb_agg(row_to_json(updated.*)) INTO v_rows FROM updated;

    IF v_rows IS NULL THEN
      WITH inserted AS (
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, 'item', v_drop.item_id, 1)
        RETURNING *
      )
      SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;
    END IF;
  END IF;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_world_drop_id', p_drop_id,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pickup_world_drop(UUID, UUID) TO authenticated;
