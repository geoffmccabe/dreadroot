-- Raise blueprint size limit to 100,000 blocks
-- T26+ trees can have 60,000+ blocks with high branching/decorations
ALTER TABLE public.tree_blueprints DROP CONSTRAINT IF EXISTS blueprint_size_limit;
ALTER TABLE public.tree_blueprints ADD CONSTRAINT blueprint_size_limit CHECK (block_count <= 100000);
