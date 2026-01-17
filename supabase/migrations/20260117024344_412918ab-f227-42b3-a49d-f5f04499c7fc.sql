-- Remove duplicate trigger that's causing double chunk_version bumps
DROP TRIGGER IF EXISTS trg_chunk_versions_on_blocks_change ON public.placed_blocks;
DROP FUNCTION IF EXISTS chunk_versions_on_blocks_change();