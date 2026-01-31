import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTree() {
  const baseX = -7;
  const baseY = 0;
  const baseZ = 57;

  console.log(`\n=== Checking tree at (${baseX}, ${baseY}, ${baseZ}) ===\n`);

  // 1. Check planted_trees
  const { data: trees, error: treeError } = await supabase
    .from('planted_trees')
    .select('*, seed_definitions(tier, name)')
    .eq('base_x', baseX)
    .eq('base_y', baseY)
    .eq('base_z', baseZ);

  if (treeError) {
    console.log('ERROR querying planted_trees:', treeError.message);
    return;
  }

  if (!trees || trees.length === 0) {
    console.log('*** NO PLANTED_TREES RECORD FOUND ***');
    console.log('The tree does not exist in the database!');
    return;
  }

  const tree = trees[0];
  console.log('PLANTED_TREES RECORD:');
  console.log(`  ID: ${tree.id}`);
  console.log(`  World ID: ${tree.world_id}`);
  console.log(`  Tier: ${tree.seed_definitions?.tier}`);
  console.log(`  Name: ${tree.seed_definitions?.name}`);
  console.log(`  Is Fully Grown: ${tree.is_fully_grown}`);
  console.log(`  Target Block Count: ${tree.target_block_count}`);
  console.log(`  Current Block Count: ${tree.current_block_count}`);
  console.log(`  Growth Seed: ${tree.growth_seed}`);

  // 2. Check blueprint
  const { data: blueprint, error: bpError } = await supabase
    .from('tree_blueprints')
    .select('*')
    .eq('planted_tree_id', tree.id)
    .maybeSingle();

  if (bpError) {
    console.log('\nBLUEPRINT ERROR:', bpError.message);
  } else if (!blueprint) {
    console.log('\n*** NO BLUEPRINT FOUND ***');
    console.log('This tree has no blueprint - blocks cannot be restored!');
  } else {
    const blocks = blueprint.blueprint_data?.blocks || [];
    console.log(`\nBLUEPRINT: ${blocks.length} blocks`);
  }

  // 3. Check placed_blocks at trunk position
  const { data: trunkBlocks, error: pbError } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type')
    .eq('world_id', tree.world_id)
    .eq('position_x', baseX)
    .eq('position_z', baseZ)
    .order('position_y', { ascending: true });

  if (pbError) {
    console.log('\nPLACED_BLOCKS ERROR:', pbError.message);
    return;
  }

  console.log(`\nPLACED_BLOCKS at trunk (${baseX}, *, ${baseZ}): ${trunkBlocks?.length || 0} blocks`);

  if (trunkBlocks && trunkBlocks.length > 0) {
    console.log('Trunk blocks found:');
    for (const b of trunkBlocks.slice(0, 10)) {
      console.log(`  Y=${b.position_y}: ${b.block_type}`);
    }
    if (trunkBlocks.length > 10) {
      console.log(`  ... and ${trunkBlocks.length - 10} more`);
    }
  } else {
    console.log('*** NO BLOCKS IN DATABASE AT TRUNK POSITION ***');
  }

  // 4. Check all tree blocks in the area
  const { data: areaBlocks, count } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('world_id', tree.world_id)
    .gte('position_x', baseX - 20)
    .lte('position_x', baseX + 20)
    .gte('position_z', baseZ - 20)
    .lte('position_z', baseZ + 20)
    .limit(5000);

  const treeBlockPrefixes = ['t_', 'b_', 'l_', 's_', 'n_', 'x_', 'sm_', 'ss_', 'sc_', 'ib_', 'f_'];
  const treeBlocks = (areaBlocks || []).filter(b =>
    treeBlockPrefixes.some(prefix => b.block_type?.startsWith(prefix))
  );

  console.log(`\nAREA SCAN (40x40 around tree):`);
  console.log(`  Total blocks: ${count}`);
  console.log(`  Tree blocks: ${treeBlocks.length}`);

  // Check chunk
  const chunkX = Math.floor(baseX / 16);
  const chunkZ = Math.floor(baseZ / 16);
  console.log(`\nCHUNK: (${chunkX}, ${chunkZ})`);

  const { data: chunkBlocks, count: chunkCount } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('world_id', tree.world_id)
    .eq('chunk_x', chunkX)
    .eq('chunk_z', chunkZ)
    .limit(1);

  console.log(`  Blocks in chunk: ${chunkCount}`);
}

checkTree().catch(console.error);
