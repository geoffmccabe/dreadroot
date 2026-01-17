-- Fix trigger function to use correct parameter order: (p_world, p_cx, p_cz)
CREATE OR REPLACE FUNCTION public.trigger_bump_chunk_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- For deletes, use the OLD row's chunk coordinates
    IF OLD.chunk_x IS NOT NULL AND OLD.chunk_z IS NOT NULL AND OLD.world_id IS NOT NULL THEN
      -- Correct order: world_id first, then chunk_x, chunk_z
      PERFORM bump_chunk_version(OLD.world_id, OLD.chunk_x, OLD.chunk_z);
    END IF;
    RETURN OLD;
  ELSE
    -- For inserts and updates, use the NEW row's chunk coordinates
    IF NEW.chunk_x IS NOT NULL AND NEW.chunk_z IS NOT NULL AND NEW.world_id IS NOT NULL THEN
      -- Correct order: world_id first, then chunk_x, chunk_z
      PERFORM bump_chunk_version(NEW.world_id, NEW.chunk_x, NEW.chunk_z);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;