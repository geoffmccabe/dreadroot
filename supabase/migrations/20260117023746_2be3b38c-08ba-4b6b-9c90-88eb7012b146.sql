-- Create trigger function that calls bump_chunk_version on block changes
CREATE OR REPLACE FUNCTION public.trigger_bump_chunk_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- For deletes, use the OLD row's chunk coordinates
    IF OLD.chunk_x IS NOT NULL AND OLD.chunk_z IS NOT NULL AND OLD.world_id IS NOT NULL THEN
      PERFORM bump_chunk_version(OLD.chunk_x, OLD.chunk_z, OLD.world_id);
    END IF;
    RETURN OLD;
  ELSE
    -- For inserts and updates, use the NEW row's chunk coordinates
    IF NEW.chunk_x IS NOT NULL AND NEW.chunk_z IS NOT NULL AND NEW.world_id IS NOT NULL THEN
      PERFORM bump_chunk_version(NEW.chunk_x, NEW.chunk_z, NEW.world_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on placed_blocks table
DROP TRIGGER IF EXISTS placed_blocks_bump_chunk_version ON public.placed_blocks;

CREATE TRIGGER placed_blocks_bump_chunk_version
AFTER INSERT OR UPDATE OR DELETE ON public.placed_blocks
FOR EACH ROW
EXECUTE FUNCTION public.trigger_bump_chunk_version();