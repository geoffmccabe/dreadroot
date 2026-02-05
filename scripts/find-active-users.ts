/**
 * Find active users - try different approaches
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MAGOR_WORLD_ID = 'def654df-0d47-44be-8d40-821f5ad1c3db';
const DEFAULT_WORLD_ID = '0a407a30-9d6a-426c-8114-b8a17096773a';

async function main() {
  console.log('=== FIND ACTIVE USERS ===\n');

  // Try Magor world first (this worked before)
  console.log('Checking Magor world, chunk [0,0]:');
  const { data: magorBlocks, error: e1 } = await supabase
    .from('placed_blocks')
    .select('user_id, block_type')
    .eq('world_id', MAGOR_WORLD_ID)
    .eq('chunk_x', 0)
    .eq('chunk_z', 0)
    .limit(50);

  if (e1) {
    console.log('  Error:', e1.message);
  } else {
    const users = [...new Set(magorBlocks?.map(b => b.user_id))];
    console.log('  Users found:', users);
  }

  // Try Default world
  console.log('\nChecking Default world, chunk [0,0]:');
  const { data: defaultBlocks, error: e2 } = await supabase
    .from('placed_blocks')
    .select('user_id, block_type')
    .eq('world_id', DEFAULT_WORLD_ID)
    .eq('chunk_x', 0)
    .eq('chunk_z', 0)
    .limit(50);

  if (e2) {
    console.log('  Error:', e2.message);
  } else {
    const users = [...new Set(defaultBlocks?.map(b => b.user_id))];
    console.log('  Users found:', users);
  }

  // Check multiple chunks in Default world
  console.log('\nChecking multiple chunks in Default world:');
  const chunks = [[0,1], [1,0], [1,1], [-1,0], [0,-1], [-1,-1], [1,2], [2,1]];
  const allUsers = new Set<string>();

  for (const [cx, cz] of chunks) {
    const { data: blocks, error } = await supabase
      .from('placed_blocks')
      .select('user_id')
      .eq('world_id', DEFAULT_WORLD_ID)
      .eq('chunk_x', cx)
      .eq('chunk_z', cz)
      .limit(50);

    if (!error && blocks) {
      blocks.forEach(b => allUsers.add(b.user_id));
    }
  }

  console.log('  All users found across chunks:', [...allUsers]);

  // Check worlds table
  console.log('\nAll worlds:');
  const { data: worlds, error: e3 } = await supabase
    .from('worlds')
    .select('id, name');

  if (e3) {
    console.log('  Error:', e3.message);
  } else {
    worlds?.forEach(w => console.log(`  ${w.name}: ${w.id}`));
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
