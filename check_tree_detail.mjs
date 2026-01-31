import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTree() {
  const baseX = -39;
  const baseY = 0;
  const baseZ = 88;

  console.log(`\n=== Checking tree at (${baseX}, ${baseY}, ${baseZ}) ===\n`);

  // Find the planted tree
  const { data: trees, error: treeError } = await supabase
    .from('planted_trees')
    .select('*, seed_definitions(tier, name)')
    .eq('base_x', baseX)
    .eq('base_y', baseY)
    .eq('base_z', baseZ);

  if (treeError || !trees || trees.length === 0) {
    console.log('No planted_trees record found at this location');
    return;
  }

  const tree = trees[0];
  console.log('PLANTED_TREES RECORD:');
  console.log(`  Tree ID: ${tree.id}`);
  console.log(`  World ID: ${tree.world_id}`);
  console.log(`  Tier: ${tree.seed_definitions?.tier || 'unknown'}`);
  console.log(`  Is Fully Grown: ${tree.is_fully_grown}`);
  console.log(`  Current Block Count (metadata): ${tree.current_block_count}`);
  console.log(`  Target Block Count: ${tree.target_block_count}`);

  // Get the blueprint
  const { data: blueprint, error: bpError } = await supabase
    .from('tree_blueprints')
    .select('*')
    .eq('planted_tree_id', tree.id)
    .single();

  if (bpError || !blueprint) {
    console.log('\nBLUEPRINT: Not found!');
    return;
  }

  const bpData = blueprint.blueprint_data || {};
  const bpBlocks = bpData.blocks || [];
  console.log(`\nBLUEPRINT:`);
  console.log(`  Total blocks in blueprint: ${bpBlocks.length}`);

  // Count by type in blueprint
  const bpTypeCounts = {};
  for (const b of bpBlocks) {
    bpTypeCounts[b.type] = (bpTypeCounts[b.type] || 0) + 1;
  }
  console.log(`  Block types in blueprint:`, JSON.stringify(bpTypeCounts));

  // Get Y range in blueprint
  if (bpBlocks.length > 0) {
    const ys = bpBlocks.map(b => b.y);
    console.log(`  Y range in blueprint: ${Math.min(...ys)} to ${Math.max(...ys)}`);
  }

  // Check trunk blocks specifically in blueprint (blocks at base x,z position)
  const trunkBlocksInBP = bpBlocks.filter(b => b.x === baseX && b.z === baseZ);
  console.log(`\n  TRUNK in blueprint (x=${baseX}, z=${baseZ}):`);
  console.log(`    Count: ${trunkBlocksInBP.length}`);
  if (trunkBlocksInBP.length > 0) {
    const trunkYs = trunkBlocksInBP.map(b => b.y).sort((a, b) => a - b);
    console.log(`    Y values: ${trunkYs.join(', ')}`);

    // Check for gaps
    const gaps = [];
    for (let i = 1; i < trunkYs.length; i++) {
      if (trunkYs[i] - trunkYs[i-1] > 1) {
        gaps.push(`gap between Y=${trunkYs[i-1]} and Y=${trunkYs[i]}`);
      }
    }
    if (gaps.length > 0) {
      console.log(`    *** GAPS IN BLUEPRINT TRUNK: ${gaps.join(', ')}`);
    } else {
      console.log(`    No gaps in blueprint trunk`);
    }
  }

  // Now check placed_blocks
  const searchRadius = 50;
  const { data: placedBlocks, error: pbError } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type')
    .eq('world_id', tree.world_id)
    .gte('position_x', baseX - searchRadius)
    .lte('position_x', baseX + searchRadius)
    .gte('position_z', baseZ - searchRadius)
    .lte('position_z', baseZ + searchRadius)
    .limit(10000);

  if (pbError) {
    console.log('\nPLACED_BLOCKS ERROR:', pbError.message);
    return;
  }

  // Filter to tree blocks
  const treeBlockPrefixes = ['t_', 'b_', 'l_', 's_', 'n_', 'x_', 'sm_', 'ss_', 'sc_', 'ib_', 'f_'];
  const treeBlocks = (placedBlocks || []).filter(b =>
    treeBlockPrefixes.some(prefix => b.block_type && b.block_type.startsWith(prefix))
  );

  console.log(`\nPLACED_BLOCKS:`);
  console.log(`  Total in area: ${placedBlocks?.length || 0}`);
  console.log(`  Tree blocks: ${treeBlocks.length}`);

  // Check trunk in placed_blocks
  const trunkBlocksInDB = treeBlocks.filter(b => b.position_x === baseX && b.position_z === baseZ);
  console.log(`\n  TRUNK in placed_blocks (x=${baseX}, z=${baseZ}):`);
  console.log(`    Count: ${trunkBlocksInDB.length}`);
  if (trunkBlocksInDB.length > 0) {
    const trunkYs = trunkBlocksInDB.map(b => b.position_y).sort((a, b) => a - b);
    console.log(`    Y values: ${trunkYs.join(', ')}`);

    // Check for gaps
    const gaps = [];
    for (let i = 1; i < trunkYs.length; i++) {
      if (trunkYs[i] - trunkYs[i-1] > 1) {
        gaps.push(`gap between Y=${trunkYs[i-1]} and Y=${trunkYs[i]}`);
      }
    }
    if (gaps.length > 0) {
      console.log(`    *** GAPS IN DB TRUNK: ${gaps.join(', ')}`);
    } else {
      console.log(`    No gaps in DB trunk`);
    }
  }

  // Compare blueprint vs placed_blocks
  console.log(`\n=== COMPARISON ===`);

  // Build set of placed block positions
  const placedSet = new Set(treeBlocks.map(b => `${b.position_x},${b.position_y},${b.position_z}`));

  // Find missing blocks (in blueprint but not in placed_blocks)
  const missingBlocks = bpBlocks.filter(b => !placedSet.has(`${b.x},${b.y},${b.z}`));

  console.log(`  Blueprint blocks: ${bpBlocks.length}`);
  console.log(`  Placed blocks: ${treeBlocks.length}`);
  console.log(`  MISSING from DB: ${missingBlocks.length}`);

  if (missingBlocks.length > 0 && missingBlocks.length <= 20) {
    console.log(`  Missing positions:`);
    for (const b of missingBlocks) {
      console.log(`    (${b.x}, ${b.y}, ${b.z}) - ${b.type}`);
    }
  } else if (missingBlocks.length > 20) {
    console.log(`  First 20 missing:`);
    for (const b of missingBlocks.slice(0, 20)) {
      console.log(`    (${b.x}, ${b.y}, ${b.z}) - ${b.type}`);
    }
  }

  // Check missing trunk blocks specifically
  const missingTrunk = missingBlocks.filter(b => b.x === baseX && b.z === baseZ);
  if (missingTrunk.length > 0) {
    console.log(`\n  *** MISSING TRUNK BLOCKS: ${missingTrunk.length}`);
    const missingTrunkYs = missingTrunk.map(b => b.y).sort((a, b) => a - b);
    console.log(`    Missing Y values: ${missingTrunkYs.join(', ')}`);
  }
}

checkTree().catch(console.error);
