/**
 * Diagnostic script to find orphan blocks in the database
 * Run with: npx tsx scripts/find-orphan-blocks.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function findOrphanBlocks() {
  console.log('=== ORPHAN BLOCK DIAGNOSTIC ===\n');

  // 1. Find blocks with NULL chunk coordinates
  console.log('1. Blocks with NULL chunk_x or chunk_z:');
  const { data: nullChunks, error: err1 } = await supabase
    .from('placed_blocks')
    .select('id, user_id, position_x, position_y, position_z, block_type, world_id, chunk_x, chunk_z, created_at')
    .or('chunk_x.is.null,chunk_z.is.null')
    .limit(50);

  if (err1) {
    console.error('  Error:', err1.message);
  } else if (nullChunks && nullChunks.length > 0) {
    console.log(`  Found ${nullChunks.length} blocks with NULL chunk coordinates:`);
    nullChunks.forEach(b => {
      console.log(`  - [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} user=${b.user_id?.slice(0,8)}... world=${b.world_id?.slice(0,8)}...`);
    });
  } else {
    console.log('  None found.');
  }

  // 2. Find blocks with NULL world_id
  console.log('\n2. Blocks with NULL world_id:');
  const { data: nullWorld, error: err2 } = await supabase
    .from('placed_blocks')
    .select('id, user_id, position_x, position_y, position_z, block_type, world_id, chunk_x, chunk_z, created_at')
    .is('world_id', null)
    .limit(50);

  if (err2) {
    console.error('  Error:', err2.message);
  } else if (nullWorld && nullWorld.length > 0) {
    console.log(`  Found ${nullWorld.length} blocks with NULL world_id:`);
    nullWorld.forEach(b => {
      console.log(`  - [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} user=${b.user_id?.slice(0,8)}...`);
    });
  } else {
    console.log('  None found.');
  }

  // 3. Find blocks near the reported position (-7, 0, 46)
  console.log('\n3. Blocks near position (-7, 0, 46):');
  const { data: nearBlocks, error: err3 } = await supabase
    .from('placed_blocks')
    .select('*')
    .gte('position_x', -15)
    .lte('position_x', 0)
    .gte('position_y', -2)
    .lte('position_y', 5)
    .gte('position_z', 30)
    .lte('position_z', 55);

  if (err3) {
    console.error('  Error:', err3.message);
  } else if (nearBlocks && nearBlocks.length > 0) {
    console.log(`  Found ${nearBlocks.length} blocks in that area:`);
    nearBlocks.forEach(b => {
      console.log(`  - [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} chunk=[${b.chunk_x},${b.chunk_z}] user=${b.user_id?.slice(0,8)}... world=${b.world_id?.slice(0,8)}...`);
    });
  } else {
    console.log('  None found.');
  }

  // 4. Get list of all worlds
  console.log('\n4. All worlds in database:');
  const { data: worlds, error: err4 } = await supabase
    .from('worlds')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });

  if (err4) {
    console.error('  Error:', err4.message);
  } else if (worlds) {
    worlds.forEach(w => {
      console.log(`  - ${w.name}: ${w.id}`);
    });
  }

  // 5. Get list of all users who have placed blocks
  console.log('\n5. Users who have placed blocks:');
  const { data: users, error: err5 } = await supabase
    .from('placed_blocks')
    .select('user_id')
    .limit(1000);

  if (err5) {
    console.error('  Error:', err5.message);
  } else if (users) {
    const uniqueUsers = [...new Set(users.map(u => u.user_id))];
    console.log(`  ${uniqueUsers.length} unique users have placed blocks`);
    uniqueUsers.slice(0, 10).forEach(uid => {
      console.log(`  - ${uid}`);
    });
    if (uniqueUsers.length > 10) {
      console.log(`  ... and ${uniqueUsers.length - 10} more`);
    }
  }

  // 6. Count blocks by world
  console.log('\n6. Block counts by world:');
  const { data: worldCounts, error: err6 } = await supabase
    .rpc('count_blocks_by_world');

  if (err6) {
    // Fallback if RPC doesn't exist
    console.log('  (RPC not available, using fallback)');
    if (worlds) {
      for (const w of worlds.slice(0, 5)) {
        const { count } = await supabase
          .from('placed_blocks')
          .select('*', { count: 'exact', head: true })
          .eq('world_id', w.id);
        console.log(`  - ${w.name}: ${count} blocks`);
      }
    }
  } else if (worldCounts) {
    worldCounts.forEach((wc: any) => {
      console.log(`  - ${wc.world_id}: ${wc.count} blocks`);
    });
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
}

findOrphanBlocks().catch(console.error);
