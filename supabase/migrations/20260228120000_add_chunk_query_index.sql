-- Add compound index for chunk queries on placed_blocks.
-- Without this index, per-chunk Supabase fetches do sequential scans
-- over 680K+ rows, taking 3+ seconds each.
-- With the index, each chunk fetch should take <50ms.

CREATE INDEX IF NOT EXISTS idx_placed_blocks_world_chunk
  ON placed_blocks (world_id, chunk_x, chunk_z);
