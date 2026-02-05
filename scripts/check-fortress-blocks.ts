/**
 * Check fortress blocks ownership and details
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('=== FORTRESS BLOCK DETAILS ===\n');

  // Get blocks in small area without block_type filter (avoid full scan)
  // Looking near the known fortress area
  const { data: areaBlocks, error } = await supabase
    .from('placed_blocks')
    .select('*')
    .gte('position_x', -10)
    .lte('position_x', 0)
    .gte('position_z', 35)
    .lte('position_z', 50)
    .limit(100);

  // Filter fortress_blocks client-side
  const fortressBlocks = areaBlocks?.filter(b => b.block_type === 'fortress_block');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${fortressBlocks?.length || 0} fortress_blocks:\n`);

  // Group by user_id
  const byUser = new Map<string, any[]>();
  fortressBlocks?.forEach(b => {
    const uid = b.user_id || 'null';
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(b);
  });

  for (const [userId, blocks] of byUser) {
    console.log(`\nUser: ${userId}`);
    console.log(`  ${blocks.length} blocks`);
    blocks.slice(0, 10).forEach(b => {
      console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] world=${b.world_id?.slice(0,8)}... chunk=[${b.chunk_x},${b.chunk_z}] created=${b.created_at}`);
    });
    if (blocks.length > 10) console.log(`  ...and ${blocks.length - 10} more`);
  }

  // Get profiles for these users
  console.log('\n=== USER PROFILES ===');
  for (const userId of byUser.keys()) {
    if (userId === 'null') continue;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, role')
      .eq('id', userId)
      .single();
    console.log(`  ${userId}: ${profile?.username || 'NO PROFILE'} (${profile?.role || 'no role'})`);
  }

  // Check the default world ID
  const { data: world } = await supabase
    .from('worlds')
    .select('id, name')
    .eq('name', 'Default World')
    .single();

  console.log(`\nDefault World: ${world?.id}`);

  // Count fortress blocks by world
  console.log('\n=== FORTRESS BLOCKS BY WORLD ===');
  const worlds = [...new Set(fortressBlocks?.map(b => b.world_id))];
  for (const wid of worlds) {
    const count = fortressBlocks?.filter(b => b.world_id === wid).length;
    const { data: w } = await supabase.from('worlds').select('name').eq('id', wid).single();
    console.log(`  ${w?.name || wid}: ${count} fortress_blocks`);
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
