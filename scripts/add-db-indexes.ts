/**
 * Add missing indexes to placed_blocks table to fix query timeouts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== ADDING DATABASE INDEXES ===\n');

  // Add composite index for world + chunk queries
  console.log('Adding index: idx_placed_blocks_world_chunk...');
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_placed_blocks_world_chunk ON placed_blocks(world_id, chunk_x, chunk_z);'
  });
  if (e1) {
    console.log('  Error (may need to run via SQL editor):', e1.message);
  } else {
    console.log('  ✓ Created');
  }

  // Add index for block_type queries
  console.log('Adding index: idx_placed_blocks_block_type...');
  const { error: e2 } = await supabase.rpc('exec_sql', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_placed_blocks_block_type ON placed_blocks(block_type);'
  });
  if (e2) {
    console.log('  Error (may need to run via SQL editor):', e2.message);
  } else {
    console.log('  ✓ Created');
  }

  // Add index for user_id queries
  console.log('Adding index: idx_placed_blocks_user_id...');
  const { error: e3 } = await supabase.rpc('exec_sql', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_placed_blocks_user_id ON placed_blocks(user_id);'
  });
  if (e3) {
    console.log('  Error (may need to run via SQL editor):', e3.message);
  } else {
    console.log('  ✓ Created');
  }

  console.log('\n=== DONE ===');
  console.log('\nIf indexes failed, run this SQL in Supabase SQL editor:');
  console.log(`
CREATE INDEX IF NOT EXISTS idx_placed_blocks_world_chunk ON placed_blocks(world_id, chunk_x, chunk_z);
CREATE INDEX IF NOT EXISTS idx_placed_blocks_block_type ON placed_blocks(block_type);
CREATE INDEX IF NOT EXISTS idx_placed_blocks_user_id ON placed_blocks(user_id);
  `);
}

main().catch(console.error);
