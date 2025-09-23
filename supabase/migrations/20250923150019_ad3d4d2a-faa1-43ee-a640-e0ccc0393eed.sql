-- Ensure REPLICA IDENTITY FULL for complete real-time updates on placed_blocks
ALTER TABLE public.placed_blocks REPLICA IDENTITY FULL;