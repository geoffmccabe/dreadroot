-- Phase D-cooldown — Generic egg pickup + generic item forge.
--
-- Key idea: drop the shpider-specific hardcoding. Eggs stay distinct
-- from item-loot drops (DreadRoot pet/NPC track), but the RPCs no
-- longer assume "shpider eggs at tiers 1–10." Adding a new egg type
-- (sknake, dragon, whatever) requires zero RPC changes — just rows in
-- the items table with the right forge_family.
--
-- Schema changes:
--   • items.forge_family             text, nullable. Items in the same
--                                    family can be forged tier→tier+1.
--   • items.pickup_cooldown_seconds  integer, nullable. NULL = no
--                                    cooldown on pickup.
--   • world_eggs.item_id             uuid FK to items(id). Replaces
--                                    the implicit "shpider_egg_t<tier>"
--                                    lookup. tier column stays for
--                                    backward compat (clients still
--                                    use it for display).
--
-- New RPCs:
--   • pickup_egg(world_egg_id, client_request_id) — atomic delete
--     world egg + insert inventory row with the item's configured
--     cooldown_until.
--   • forge_items(source_row_ids, result_item_id, client_request_id)
--     — atomic delete 2 source rows + insert 1 next-tier row of the
--     same forge_family. Result cooldown = MAX of source cooldowns.

-- ---------------------------------------------------------------------
-- 1. items: forge_family + pickup_cooldown_seconds
-- ---------------------------------------------------------------------
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS forge_family TEXT;
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS pickup_cooldown_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_items_forge_family ON public.items(forge_family)
  WHERE forge_family IS NOT NULL;

-- Backfill the existing shpider eggs. New egg types (sknake_egg_t1
-- etc.) just need to be inserted into items with a forge_family +
-- pickup_cooldown_seconds set; no RPC changes required.
UPDATE public.items
   SET forge_family = 'shpider_egg',
       pickup_cooldown_seconds = 3600
 WHERE key LIKE 'shpider_egg_t%'
   AND (forge_family IS NULL OR pickup_cooldown_seconds IS NULL);

-- ---------------------------------------------------------------------
-- 2. world_eggs: item_id column
-- ---------------------------------------------------------------------
ALTER TABLE public.world_eggs
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES public.items(id) ON DELETE CASCADE;

-- Backfill from existing tier (assumes 'shpider_egg_t<tier>' keys for
-- legacy rows; new spawns will write item_id directly).
UPDATE public.world_eggs we
   SET item_id = i.id
  FROM public.items i
 WHERE we.item_id IS NULL
   AND i.key = 'shpider_egg_t' || we.tier::text;

CREATE INDEX IF NOT EXISTS idx_world_eggs_item_id ON public.world_eggs(item_id);

-- (Leaving item_id nullable for now so that any pre-existing row whose
-- key doesn't resolve doesn't break the migration. New inserts MUST
-- set item_id — enforced in the spawn-side code update.)

-- ---------------------------------------------------------------------
-- 3. pickup_egg — atomic world_egg delete + inventory insert.
--    Cooldown comes from items.pickup_cooldown_seconds; NULL = no
--    cooldown.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pickup_egg(
  p_world_egg_id      UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_egg            RECORD;
  v_item_id        UUID;
  v_cooldown_secs  INTEGER;
  v_cooldown_until TIMESTAMPTZ;
  v_rows           JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_world_egg_id IS NULL THEN
    RAISE EXCEPTION 'world_egg_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  -- Lock the world egg.
  SELECT * INTO v_egg FROM world_eggs WHERE id = p_world_egg_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'World egg % not found', p_world_egg_id USING ERRCODE = '23503';
  END IF;
  IF v_egg.owner_user_id IS NOT NULL AND v_egg.owner_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Egg belongs to another user' USING ERRCODE = '42501';
  END IF;

  -- Resolve the item. Prefer the explicit item_id (new rows); fall back
  -- to 'shpider_egg_t<tier>' for legacy rows that haven't been backfilled
  -- yet. After the dashboard backfill runs once, all rows will have
  -- item_id set.
  v_item_id := v_egg.item_id;
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM items WHERE key = 'shpider_egg_t' || v_egg.tier::text;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Item lookup failed for egg %', v_egg.id USING ERRCODE = '23503';
    END IF;
  END IF;

  -- Pickup cooldown comes from items config.
  SELECT pickup_cooldown_seconds INTO v_cooldown_secs FROM items WHERE id = v_item_id;
  IF v_cooldown_secs IS NOT NULL AND v_cooldown_secs > 0 THEN
    v_cooldown_until := NOW() + make_interval(secs => v_cooldown_secs);
  ELSE
    v_cooldown_until := NULL;
  END IF;

  DELETE FROM world_eggs WHERE id = p_world_egg_id;

  WITH inserted AS (
    INSERT INTO user_inventory (user_id, item_type, item_id, quantity, cooldown_until)
    VALUES (v_user_id, 'item', v_item_id, 1, v_cooldown_until)
    RETURNING *
  )
  SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', '[]'::jsonb,
    'deleted_world_egg_id', p_world_egg_id,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pickup_egg(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. forge_items — generic two-source forge.
--    Works for any item with forge_family set. Source items must be:
--      * Owned by the caller
--      * Same item_id (i.e. same kind + same tier)
--      * Have a forge_family
--    Result item must be the next tier (source.tier + 1) of the same
--    family. Cooldown of the result = MAX of source cooldowns
--    (NULL sources count as the past).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forge_items(
  p_source_row_ids    UUID[],
  p_result_item_id    UUID,
  p_client_request_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_is_new         BOOLEAN;
  v_src1           RECORD;
  v_src2           RECORD;
  v_src_def        RECORD;
  v_result_def     RECORD;
  v_cooldown_until TIMESTAMPTZ;
  v_rows           JSONB;
  v_deleted_ids    JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_source_row_ids IS NULL OR array_length(p_source_row_ids, 1) <> 2 THEN
    RAISE EXCEPTION 'exactly 2 source_row_ids required' USING ERRCODE = '22023';
  END IF;
  IF p_source_row_ids[1] = p_source_row_ids[2] THEN
    RAISE EXCEPTION 'source row ids must be distinct' USING ERRCODE = '22023';
  END IF;
  IF p_result_item_id IS NULL THEN
    RAISE EXCEPTION 'result_item_id required' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required' USING ERRCODE = '22023';
  END IF;

  v_is_new := check_and_record_request(p_client_request_id, v_user_id);
  IF NOT v_is_new THEN
    RETURN json_build_object('rows', '[]'::jsonb, 'deleted_row_ids', '[]'::jsonb, 'replayed', true);
  END IF;

  -- Lock + read source rows.
  SELECT * INTO v_src1 FROM user_inventory WHERE id = p_source_row_ids[1] FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source row 1 not found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_src2 FROM user_inventory WHERE id = p_source_row_ids[2] FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source row 2 not found' USING ERRCODE = '23503'; END IF;

  IF v_src1.user_id <> v_user_id OR v_src2.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Source rows must belong to caller' USING ERRCODE = '42501';
  END IF;
  IF v_src1.item_type <> 'item' OR v_src2.item_type <> 'item' THEN
    RAISE EXCEPTION 'Source rows must be item rows' USING ERRCODE = '22023';
  END IF;
  IF v_src1.item_id IS NULL OR v_src2.item_id IS NULL THEN
    RAISE EXCEPTION 'Source rows must have item_id' USING ERRCODE = '22023';
  END IF;
  IF v_src1.item_id <> v_src2.item_id THEN
    RAISE EXCEPTION 'Source items must be the same kind + tier' USING ERRCODE = '22023';
  END IF;

  -- Look up source item def + result item def.
  SELECT id, forge_family, tier INTO v_src_def FROM items WHERE id = v_src1.item_id;
  IF v_src_def.id IS NULL THEN
    RAISE EXCEPTION 'Source item def not found' USING ERRCODE = '23503';
  END IF;
  IF v_src_def.forge_family IS NULL THEN
    RAISE EXCEPTION 'Source item has no forge_family' USING ERRCODE = '22023';
  END IF;
  IF v_src_def.tier IS NULL THEN
    RAISE EXCEPTION 'Source item has no tier' USING ERRCODE = '22023';
  END IF;

  SELECT id, forge_family, tier INTO v_result_def FROM items WHERE id = p_result_item_id;
  IF v_result_def.id IS NULL THEN
    RAISE EXCEPTION 'Result item def not found' USING ERRCODE = '23503';
  END IF;
  IF v_result_def.forge_family IS DISTINCT FROM v_src_def.forge_family THEN
    RAISE EXCEPTION 'Result must be in the same forge_family' USING ERRCODE = '22023';
  END IF;
  IF v_result_def.tier IS NULL OR v_result_def.tier <> v_src_def.tier + 1 THEN
    RAISE EXCEPTION 'Result must be exactly one tier higher (% → %)',
      v_src_def.tier, v_src_def.tier + 1 USING ERRCODE = '22023';
  END IF;

  v_cooldown_until := GREATEST(
    COALESCE(v_src1.cooldown_until, '1970-01-01 00:00:00+00'::timestamptz),
    COALESCE(v_src2.cooldown_until, '1970-01-01 00:00:00+00'::timestamptz)
  );
  IF v_cooldown_until <= NOW() THEN
    v_cooldown_until := NULL;
  END IF;

  DELETE FROM user_inventory WHERE id IN (v_src1.id, v_src2.id);
  v_deleted_ids := jsonb_build_array(v_src1.id, v_src2.id);

  WITH inserted AS (
    INSERT INTO user_inventory (user_id, item_type, item_id, quantity, cooldown_until)
    VALUES (v_user_id, 'item', p_result_item_id, 1, v_cooldown_until)
    RETURNING *
  )
  SELECT jsonb_agg(row_to_json(inserted.*)) INTO v_rows FROM inserted;

  RETURN json_build_object(
    'rows', v_rows,
    'deleted_row_ids', v_deleted_ids,
    'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forge_items(UUID[], UUID, UUID) TO authenticated;
