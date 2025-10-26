-- Add expires_at column to placed_blocks table
ALTER TABLE placed_blocks 
ADD COLUMN expires_at timestamp with time zone DEFAULT NULL;

-- Add index for efficient cleanup queries
CREATE INDEX idx_placed_blocks_expires_at ON placed_blocks(expires_at) 
WHERE expires_at IS NOT NULL;

-- Function to delete expired blocks
CREATE OR REPLACE FUNCTION delete_expired_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM placed_blocks 
  WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;