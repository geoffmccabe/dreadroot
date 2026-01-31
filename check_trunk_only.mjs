import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTrunk() {
  const baseX = -39;
  const baseZ = 88;

  console.log(`\n=== Checking trunk at x=${baseX}, z=${baseZ} ===\n`);

  // Get tree record first
  const { data: trees } = await supabase
    .from('planted_trees')
    .select('id, world_id, base_y')
    .eq('base_x', baseX)
    .eq('base_z', baseZ);

  if (!trees || trees.length === 0) {
    console.log('No tree found');
    return;
  }

  const tree = trees[0];
  console.log(`Tree ID: ${tree.id}`);
  console.log(`World ID: ${tree.world_id}`);
  console.log(`Base Y: ${tree.base_y}`);

  // Check placed_blocks at exact trunk position
  const { data: trunkBlocks, error } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type')
    .eq('world_id', tree.world_id)
    .eq('position_x', baseX)
    .eq('position_z', baseZ)
    .order('position_y', { ascending: true });

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`\nBlocks at trunk position: ${trunkBlocks?.length || 0}`);

  if (trunkBlocks && trunkBlocks.length > 0) {
    console.log('\nBlocks found:');
    for (const b of trunkBlocks) {
      console.log(`  Y=${b.position_y}: ${b.block_type}`);
    }
  }

  // Also check around the trunk to see what blocks exist nearby
  console.log('\n=== Blocks within 5 units of trunk (sample) ===');
  const { data: nearbyBlocks } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type')
    .eq('world_id', tree.world_id)
    .gte('position_x', baseX - 5)
    .lte('position_x', baseX + 5)
    .gte('position_z', baseZ - 5)
    .lte('position_z', baseZ + 5)
    .limit(100);

  if (nearbyBlocks && nearbyBlocks.length > 0) {
    // Group by position
    const positions = new Map();
    for (const b of nearbyBlocks) {
      const key = `${b.position_x},${b.position_z}`;
      if (!positions.has(key)) {
        positions.set(key, []);
      }
      positions.get(key).push(b);
    }

    console.log(`\nUnique x,z positions: ${positions.size}`);
    for (const [key, blocks] of positions) {
      const ys = blocks.map(b => b.position_y).sort((a, b) => a - b);
      console.log(`  (${key}): ${blocks.length} blocks, Y range ${Math.min(...ys)}-${Math.max(...ys)}`);
    }
  }

  // Check if there are ANY t_ (trunk) blocks in the world
  console.log('\n=== Trunk blocks (t_*) in this world ===');
  const { data: allTrunkBlocks, count } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type', { count: 'exact' })
    .eq('world_id', tree.world_id)
    .like('block_type', 't_%')
    .limit(20);

  console.log(`Total trunk blocks in world: ${count}`);
  if (allTrunkBlocks && allTrunkBlocks.length > 0) {
    console.log('Sample trunk blocks:');
    for (const b of allTrunkBlocks.slice(0, 10)) {
      console.log(`  (${b.position_x}, ${b.position_y}, ${b.position_z}): ${b.block_type}`);
    }
  }
}

checkTrunk().catch(console.error);
