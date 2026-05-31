-- admin_set_item_texture — let admin (not just superadmin) update an
-- item's texture_url. The base items table RLS only allows superadmin
-- to UPDATE; this RPC bridges admin → texture write via SECURITY
-- DEFINER. Also accepts NULL to clear the texture (used by the Delete
-- button in the egg sprite panel).
--
-- Only writes the texture_url column; nothing else can be tampered
-- with via this RPC.

CREATE OR REPLACE FUNCTION public.admin_set_item_texture(
  p_item_id     UUID,
  p_texture_url TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_row       RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (has_role(v_caller_id, 'admin'::app_role)
          OR has_role(v_caller_id, 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Admin or superadmin role required' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id required' USING ERRCODE = '22023';
  END IF;

  UPDATE items
     SET texture_url = p_texture_url
   WHERE id = p_item_id
  RETURNING id, key, name, tier, texture_url INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Item % not found', p_item_id USING ERRCODE = '23503';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_item_texture(UUID, TEXT) TO authenticated;
