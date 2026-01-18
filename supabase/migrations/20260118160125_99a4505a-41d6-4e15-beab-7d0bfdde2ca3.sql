-- Nuclear cleanup: Delete ALL ghost tree blocks (null texture tree blocks)
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom')
  AND texture_url IS NULL;

-- Also clean up any orphan tree_blocks (tree_id doesn't exist in planted_trees)
DELETE FROM tree_blocks tb
WHERE NOT EXISTS (
  SELECT 1 FROM planted_trees pt WHERE pt.id = tb.tree_id
);

-- Force ALL clients to refetch chunks by bumping versions
UPDATE chunk_versions 
SET version = version + 100000,
    updated_at = now();