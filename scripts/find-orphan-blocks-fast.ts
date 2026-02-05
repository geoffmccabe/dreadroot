/**
 * Fast diagnostic script - targeted queries only
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('=== FAST ORPHAN BLOCK DIAGNOSTIC ===\n');

  // Get current user (superadmin)
  const { data: { user } } = await supabase.auth.getUser();
  console.log('Current user:', user?.id || 'Not authenticated');

  // Get default world ID
  const { data: defaultWorld } = await supabase
    .from('worlds')
    .select('id, name')
    .eq('name', 'Default World')
    .single();

  console.log('Default World ID:', defaultWorld?.id);

  // Count total blocks in default world
  const { count: totalBlocks } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact', head: true })
    .eq('world_id', defaultWorld?.id);

  console.log('Total blocks in Default World:', totalBlocks);

  // Check if there are blocks with fortress_block type
  const { data: fortressBlocks, count: fortressCount } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('world_id', defaultWorld?.id)
    .eq('block_type', 'fortress_block')
    .limit(10);

  console.log('\nFortress blocks:', fortressCount);
  if (fortressBlocks && fortressBlocks.length > 0) {
    fortressBlocks.forEach(b => {
      console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] user=${b.user_id?.slice(0,8)}... chunk=[${b.chunk_x},${b.chunk_z}]`);
    });
  }

  // Check blocks at exact position
  const { data: exactBlock } = await supabase
    .from('placed_blocks')
    .select('*')
    .eq('position_x', -7)
    .eq('position_y', 0)
    .eq('position_z', 46);

  console.log('\nBlock at (-7, 0, 46):', exactBlock?.length ? exactBlock : 'None');

  // Check blocks in a small range around that position
  const { data: nearbyBlocks } = await supabase
    .from('placed_blocks')
    .select('*')
    .gte('position_x', -10)
    .lte('position_x', -4)
    .eq('position_y', 1)  // Check y=1 since block might be at ground level + 1
    .gte('position_z', 33)
    .lte('position_z', 50)
    .limit(20);

  console.log('\nBlocks near camera path (y=1):');
  if (nearbyBlocks && nearbyBlocks.length > 0) {
    nearbyBlocks.forEach(b => {
      console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} user=${b.user_id?.slice(0,8)}... chunk=[${b.chunk_x},${b.chunk_z}]`);
    });
  } else {
    console.log('  None found');
  }

  // Check any blocks at y=1 or y=2 in a small area
  const { data: elevatedBlocks } = await supabase
    .from('placed_blocks')
    .select('*')
    .gte('position_x', -12)
    .lte('position_x', -2)
    .gte('position_y', 0)
    .lte('position_y', 3)
    .gte('position_z', 30)
    .lte('position_z', 50)
    .limit(30);

  console.log('\nAll blocks in area x:[-12,-2] y:[0,3] z:[30,50]:');
  if (elevatedBlocks && elevatedBlocks.length > 0) {
    elevatedBlocks.forEach(b => {
      console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} chunk=[${b.chunk_x},${b.chunk_z}]`);
    });
  } else {
    console.log('  None found');
  }

  // List all distinct block types in the database
  const { data: blockTypes } = await supabase
    .from('placed_blocks')
    .select('block_type')
    .eq('world_id', defaultWorld?.id)
    .limit(1000);

  if (blockTypes) {
    const unique = [...new Set(blockTypes.map(b => b.block_type))];
    console.log('\nDistinct block types:', unique.slice(0, 20).join(', '));
    if (unique.length > 20) console.log(`  ...and ${unique.length - 20} more`);
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
