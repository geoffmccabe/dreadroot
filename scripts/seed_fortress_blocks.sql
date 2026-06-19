-- ============================================================
-- SEED THE CENTRAL FORTRESS AS REAL SUPERADMIN-OWNED BLOCKS
-- ============================================================
-- Target world: "Default World" (DreadRoot main). Pinkland uses a different
-- world_id and is unaffected.
--
-- Inserts ~5,844 unit blocks that fill the EXACT volumes of today's hardcoded
-- mesh fortress (walls + battlements), so every surface stays on the same world
-- coordinate (waterfall + interior images keep their alignment).
--
-- Notes:
--   * chunk_x / chunk_z are GENERATED columns — do NOT set them.
--   * An AFTER INSERT trigger auto-creates/bumps chunk_versions, so the client
--     will load these chunks on next (hard) refresh.
--   * ON CONFLICT DO NOTHING => safe to re-run (idempotent).
--   * Run in the Supabase SQL editor (runs as admin, bypasses RLS).
--
-- BEFORE RUNNING: replace PASTE_SUPERADMIN_USER_ID with your user id from:
--   SELECT user_id, role FROM user_roles WHERE role IN ('admin','superadmin');

INSERT INTO placed_blocks (world_id, user_id, block_type, texture_url, position_x, position_y, position_z)
SELECT
  '0a407a30-9d6a-426c-8114-b8a17096773a'::uuid,
  'PASTE_SUPERADMIN_USER_ID'::uuid,
  'fortress_block',
  '/cliff_texture_seamless.webp',
  p.x, p.y, p.z
FROM (
  -- WALLS (y 0..19) --------------------------------------------------------
  -- front-left pillar
  SELECT x, y, z FROM generate_series(-20,-3) x, generate_series(0,19) y, unnest(ARRAY[-9,-8]) z
  UNION
  -- front-right pillar
  SELECT x, y, z FROM generate_series(2,19) x, generate_series(0,19) y, unnest(ARRAY[-9,-8]) z
  UNION
  -- gate lintel (spans opening, only y >= 5)
  SELECT x, y, z FROM generate_series(-2,1) x, generate_series(5,19) y, unnest(ARRAY[-9,-8]) z
  UNION
  -- left side wall
  SELECT x, y, z FROM unnest(ARRAY[-20,-19]) x, generate_series(0,19) y, generate_series(-40,-9) z
  UNION
  -- right side wall
  SELECT x, y, z FROM unnest(ARRAY[18,19]) x, generate_series(0,19) y, generate_series(-40,-9) z
  UNION
  -- back wall
  SELECT x, y, z FROM generate_series(-20,19) x, generate_series(0,19) y, unnest(ARRAY[-41,-40]) z
  UNION
  -- BATTLEMENTS (y 20..21), 2-on-2-off merlons -----------------------------
  -- front + back edges (run along x)
  SELECT x, y, z FROM generate_series(-20,19) x, generate_series(20,21) y, unnest(ARRAY[-9,-8,-41,-40]) z
    WHERE ((x + 20) / 2) % 2 = 0
  UNION
  -- left + right edges (run along z)
  SELECT x, y, z FROM unnest(ARRAY[-20,-19,18,19]) x, generate_series(20,21) y, generate_series(-40,-9) z
    WHERE ((z + 40) / 2) % 2 = 0
) AS p(x, y, z)
ON CONFLICT (world_id, position_x, position_y, position_z) DO NOTHING;

-- Verify count after running:
--   SELECT count(*) FROM placed_blocks
--   WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a'
--     AND block_type = 'fortress_block';   -- expect ~5844

-- Rollback (removes every seeded fortress block):
--   DELETE FROM placed_blocks
--   WHERE world_id = '0a407a30-9d6a-426c-8114-b8a17096773a'
--     AND block_type = 'fortress_block';
