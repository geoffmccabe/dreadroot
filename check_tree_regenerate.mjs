import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

// Simple seeded random
function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function seededInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function seededShuffle(array, rng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seededChoice(array, rng) {
  return array[Math.floor(rng() * array.length)];
}

const HORIZONTAL_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BLOCKS_PER_TIER_HEIGHT = 3;

function applySymmetry(x, z, baseX, baseZ, mode) {
  const relX = x - baseX;
  const relZ = z - baseZ;
  switch (mode) {
    case 'none': return [{ x, z }];
    case '2xs': return [
      { x: baseX + relX, z: baseZ + relZ },
      { x: baseX + relX, z: baseZ - relZ },
      { x: baseX - relX, z: baseZ + relZ },
      { x: baseX - relX, z: baseZ - relZ },
    ];
    case '4r': return [
      { x: baseX + relX, z: baseZ + relZ },
      { x: baseX - relZ, z: baseZ + relX },
      { x: baseX - relX, z: baseZ - relZ },
      { x: baseX + relZ, z: baseZ - relX },
    ];
    case '4x2': return [
      { x: baseX + relX, z: baseZ + relZ },
      { x: baseX + relX, z: baseZ - relZ },
      { x: baseX - relZ, z: baseZ + relX },
      { x: baseX + relZ, z: baseZ + relX },
      { x: baseX - relX, z: baseZ - relZ },
      { x: baseX - relX, z: baseZ + relZ },
      { x: baseX + relZ, z: baseZ - relX },
      { x: baseX - relZ, z: baseZ - relX },
    ];
    default: return [{ x, z }];
  }
}

function getDirectionsForSymmetry(mode) {
  switch (mode) {
    case 'none': return HORIZONTAL_DIRECTIONS;
    case '2xs':
    case '4r':
    case '4x2': return [[1, 0], [0, 1]];
    default: return HORIZONTAL_DIRECTIONS;
  }
}

// Simplified blueprint generation (trunk + branches only, no decorations for this check)
function generateSimpleBlueprint(baseX, baseY, baseZ, tier, widthFactor, branchingFactor, seed, opts) {
  const rng = createSeededRandom(seed);
  const blocks = [];
  const occupied = new Set();
  const symmetryMode = opts?.symmetry ?? 'none';

  const maxHeight = tier * BLOCKS_PER_TIER_HEIGHT;
  const maxBranchLength = Math.max(1, Math.floor(maxHeight * widthFactor));

  const addBlock = (x, y, z, type) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y, z: pos.z, type });
      }
    }
  };

  // Trunk
  for (let h = 0; h < maxHeight; h++) {
    const key = `${baseX},${baseY + h},${baseZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({ x: baseX, y: baseY + h, z: baseZ, type: 'trunk' });
    }
  }

  // Branches
  const minBranches = Math.max(1, Math.floor(maxHeight * 0.2));
  const maxBranches = Math.floor(maxHeight * branchingFactor * 0.6 * 3);
  const branchCount = seededInt(minBranches, maxBranches, rng);

  const lowBranchHeight = opts?.lowBranchHeight ?? 2;
  const availableHeights = [];
  for (let h = lowBranchHeight; h < maxHeight - 1; h++) {
    availableHeights.push(baseY + h);
  }

  const shuffledHeights = seededShuffle(availableHeights, rng);
  const candidateBranchHeights = shuffledHeights.slice(0, branchCount * 2);
  const availableDirections = getDirectionsForSymmetry(symmetryMode);

  const branchHeightsByDirection = new Map();
  const MIN_BRANCH_GAP = 2;

  let branchesCreated = 0;
  for (const branchY of candidateBranchHeights) {
    if (branchesCreated >= branchCount) break;

    const direction = seededChoice(availableDirections, rng);
    const dirKey = `${direction[0]},${direction[1]}`;

    const existingHeights = branchHeightsByDirection.get(dirKey) || [];
    const hasConflict = existingHeights.some(h => Math.abs(h - branchY) < MIN_BRANCH_GAP);

    if (hasConflict) continue;

    if (!branchHeightsByDirection.has(dirKey)) {
      branchHeightsByDirection.set(dirKey, []);
    }
    branchHeightsByDirection.get(dirKey).push(branchY);

    // Simple branch growth
    let x = baseX;
    let y = branchY;
    let z = baseZ;
    const length = seededInt(1, maxBranchLength, rng);

    for (let i = 0; i < length; i++) {
      x += direction[0];
      z += direction[1];
      if (rng() < 0.3) y += 1;
      addBlock(x, y, z, 'branch');

      // Add junction ring at first step
      if (i === 0) {
        const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        for (const [dx, dz] of offsets) {
          const key = `${baseX+dx},${y},${baseZ+dz}`;
          if (!occupied.has(key)) {
            occupied.add(key);
            blocks.push({ x: baseX+dx, y, z: baseZ+dz, type: 'branch' });
          }
        }
      }
    }

    branchesCreated++;
  }

  return { blocks, maxHeight };
}

async function checkTree() {
  const baseX = -39;
  const baseY = 0;
  const baseZ = 88;

  console.log(`\n=== Regenerating blueprint for tree at (${baseX}, ${baseY}, ${baseZ}) ===\n`);

  // Get tree record
  const { data: trees, error: treeError } = await supabase
    .from('planted_trees')
    .select('*, seed_definitions(*)')
    .eq('base_x', baseX)
    .eq('base_y', baseY)
    .eq('base_z', baseZ);

  if (treeError || !trees || trees.length === 0) {
    console.log('No planted_trees record found');
    return;
  }

  const tree = trees[0];
  const seedDef = tree.seed_definitions;

  console.log('TREE RECORD:');
  console.log(`  ID: ${tree.id}`);
  console.log(`  Growth Seed: ${tree.growth_seed}`);
  console.log(`  Tier: ${seedDef.tier}`);
  console.log(`  Width Factor: ${seedDef.width_factor}`);
  console.log(`  Branching Factor: ${seedDef.branching_factor}`);
  console.log(`  Symmetry: ${seedDef.symmetry || 'none'}`);
  console.log(`  Target Block Count: ${tree.target_block_count}`);
  console.log(`  Is Fully Grown: ${tree.is_fully_grown}`);

  // Build growth options
  const opts = {
    lowBranchHeight: seedDef.low_branch_height ?? 2,
    spikeChance: seedDef.spike_chance ?? 0,
    spikeLength: seedDef.spike_length ?? 3,
    nobChance: seedDef.nob_chance ?? 0,
    nobSize: seedDef.nob_size ?? 1,
    crossChance: seedDef.cross_chance ?? 0,
    crossLength: seedDef.cross_length ?? 3,
    shroomChance: seedDef.shroom_chance ?? 0,
    shroomLength: seedDef.shroom_length ?? 5,
    shroomCapDiameter: seedDef.shroom_cap_diameter ?? 3,
    symmetry: seedDef.symmetry ?? 'none',
  };

  console.log('\n=== Generating Blueprint ===');

  // Generate blueprint
  const blueprint = generateSimpleBlueprint(
    baseX, baseY, baseZ,
    seedDef.tier,
    seedDef.width_factor,
    seedDef.branching_factor,
    tree.growth_seed,
    opts
  );

  console.log(`  Generated ${blueprint.blocks.length} blocks (simplified, no decorations)`);

  // Count trunk blocks in blueprint
  const bpTrunkBlocks = blueprint.blocks.filter(b => b.x === baseX && b.z === baseZ);
  console.log(`  Trunk blocks in blueprint: ${bpTrunkBlocks.length}`);
  if (bpTrunkBlocks.length > 0) {
    const trunkYs = bpTrunkBlocks.map(b => b.y).sort((a, b) => a - b);
    console.log(`  Trunk Y range: ${Math.min(...trunkYs)} to ${Math.max(...trunkYs)}`);

    // Check for gaps
    const gaps = [];
    for (let i = 1; i < trunkYs.length; i++) {
      if (trunkYs[i] - trunkYs[i-1] > 1) {
        gaps.push(`Y=${trunkYs[i-1]} to Y=${trunkYs[i]}`);
      }
    }
    if (gaps.length > 0) {
      console.log(`  *** GAPS IN GENERATED TRUNK: ${gaps.join(', ')}`);
    } else {
      console.log(`  No gaps in generated trunk`);
    }
  }

  // Get placed_blocks from database
  console.log('\n=== Checking Database ===');

  const searchRadius = 100;
  const { data: placedBlocks, error: pbError } = await supabase
    .from('placed_blocks')
    .select('position_x, position_y, position_z, block_type')
    .eq('world_id', tree.world_id)
    .gte('position_x', baseX - searchRadius)
    .lte('position_x', baseX + searchRadius)
    .gte('position_z', baseZ - searchRadius)
    .lte('position_z', baseZ + searchRadius)
    .limit(20000);

  if (pbError) {
    console.log('ERROR:', pbError.message);
    return;
  }

  // Filter to tree blocks
  const treeBlockPrefixes = ['t_', 'b_', 'l_', 's_', 'n_', 'x_', 'sm_', 'ss_', 'sc_', 'ib_', 'f_'];
  const treeBlocks = (placedBlocks || []).filter(b =>
    treeBlockPrefixes.some(prefix => b.block_type && b.block_type.startsWith(prefix))
  );

  console.log(`  Total blocks in area: ${placedBlocks?.length || 0}`);
  console.log(`  Tree blocks: ${treeBlocks.length}`);

  // Check trunk in placed_blocks
  const dbTrunkBlocks = treeBlocks.filter(b => b.position_x === baseX && b.position_z === baseZ);
  console.log(`\n  Trunk in DB (x=${baseX}, z=${baseZ}): ${dbTrunkBlocks.length} blocks`);

  if (dbTrunkBlocks.length > 0) {
    const dbTrunkYs = dbTrunkBlocks.map(b => b.position_y).sort((a, b) => a - b);
    console.log(`  Trunk Y range: ${Math.min(...dbTrunkYs)} to ${Math.max(...dbTrunkYs)}`);
    console.log(`  Trunk Y values: ${dbTrunkYs.join(', ')}`);

    // Check for gaps
    const gaps = [];
    for (let i = 1; i < dbTrunkYs.length; i++) {
      if (dbTrunkYs[i] - dbTrunkYs[i-1] > 1) {
        gaps.push(`gap between Y=${dbTrunkYs[i-1]} and Y=${dbTrunkYs[i]}`);
      }
    }
    if (gaps.length > 0) {
      console.log(`\n  *** GAPS IN DB TRUNK: ${gaps.join(', ')}`);
    } else {
      console.log(`  No gaps in DB trunk`);
    }
  }

  // Compare generated blueprint trunk with DB trunk
  console.log('\n=== TRUNK COMPARISON ===');
  const expectedTrunkYs = new Set(bpTrunkBlocks.map(b => b.y));
  const actualTrunkYs = new Set(dbTrunkBlocks.map(b => b.position_y));

  const missingFromDB = [...expectedTrunkYs].filter(y => !actualTrunkYs.has(y)).sort((a, b) => a - b);
  const extraInDB = [...actualTrunkYs].filter(y => !expectedTrunkYs.has(y)).sort((a, b) => a - b);

  if (missingFromDB.length > 0) {
    console.log(`  MISSING from DB (${missingFromDB.length}): Y = ${missingFromDB.join(', ')}`);
  } else {
    console.log(`  All expected trunk blocks present in DB`);
  }

  if (extraInDB.length > 0) {
    console.log(`  EXTRA in DB (not in blueprint): Y = ${extraInDB.join(', ')}`);
  }
}

checkTree().catch(console.error);
