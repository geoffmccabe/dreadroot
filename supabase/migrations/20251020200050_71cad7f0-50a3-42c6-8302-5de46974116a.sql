
-- Fix the blocks table ID sequence to continue from the highest existing ID
SELECT setval(
  pg_get_serial_sequence('blocks', 'id'),
  COALESCE((SELECT MAX(id) FROM blocks), 1),
  true
);
