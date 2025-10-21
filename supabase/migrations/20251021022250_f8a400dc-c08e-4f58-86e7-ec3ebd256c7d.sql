-- Delete all blocks floating in the sky (Y > 30)
DELETE FROM placed_blocks WHERE position_y > 30;

-- Create a function to clean up sky blocks if needed in future
CREATE OR REPLACE FUNCTION public.remove_sky_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM placed_blocks WHERE position_y > 30;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;