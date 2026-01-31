-- Raise blueprint size limit from 5000 to 50000 blocks
-- High-tier trees (T15+) can have 7000-10000+ blocks
ALTER TABLE public.tree_blueprints DROP CONSTRAINT IF EXISTS blueprint_size_limit;
ALTER TABLE public.tree_blueprints ADD CONSTRAINT blueprint_size_limit CHECK (block_count <= 50000);
