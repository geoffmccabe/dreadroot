/**
 * Find ghost blocks with invalid depth values (like t_-1_1)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODU0ODA0MywiZXhwIjoyMDc0MTI0MDQzfQ.cn5mzW8NONwHbWfndrta_yISvYsKMELAw3YzAekVB5s";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DEFAULT_WORLD_ID = '0a407a30-9d6a-426c-8114-b8a17096773a';
const MAGOR_WORLD_ID = 'def654df-0d47-44be-8d40-821f5ad1c3db';

async function main() {
  console.log('=== FIND GHOST BLOCKS ===\n');

  // Search for blocks with negative depth in the type (like t_-1_1)
  // Pattern: any tree type followed by _-<number>_<tier>

  // Check specific known ghost block first
  console.log('Known ghost block at (57, 0, -41):');
  const { data: knownBlock } = await supabase
    .from('placed_blocks')
    .select('*')
    .eq('position_x', 57)
    .eq('position_y', 0)
    .eq('position_z', -41)
    .single();

  if (knownBlock) {
    console.log(`  Type: ${knownBlock.block_type}`);
    console.log(`  World: ${knownBlock.world_id}`);
    console.log(`  Chunk: [${knownBlock.chunk_x}, ${knownBlock.chunk_z}]`);
    console.log(`  Created: ${knownBlock.created_at}`);
  }

  // Search for blocks with _-1_ pattern (negative depth)
  // We need to check multiple chunks to find all ghost blocks
  console.log('\nSearching for blocks with negative depth (_-1_ pattern)...\n');

  // Check chunks around the known location
  const chunksToCheck = [
    [3, -3], [3, -2], [2, -3], [2, -2],  // Near known ghost
    [0, 0], [0, 1], [1, 0], [1, 1],       // Near spawn
    [-1, 2], [-1, 1], [0, 2]              // Near fortress
  ];

  const ghostBlocks: any[] = [];

  for (const [cx, cz] of chunksToCheck) {
    const { data: blocks, error } = await supabase
      .from('placed_blocks')
      .select('id, position_x, position_y, position_z, block_type, world_id, created_at')
      .eq('world_id', DEFAULT_WORLD_ID)
      .eq('chunk_x', cx)
      .eq('chunk_z', cz)
      .limit(500);

    if (error) {
      console.log(`  Chunk [${cx},${cz}]: Error - ${error.message}`);
      continue;
    }

    // Filter for blocks with negative depth pattern
    const ghosts = blocks?.filter(b => {
      // Match patterns like t_-1_1, trunk_-1_5, b_-2_3, etc.
      return b.block_type && /_-\d+_/.test(b.block_type);
    }) || [];

    if (ghosts.length > 0) {
      console.log(`Chunk [${cx},${cz}]: Found ${ghosts.length} ghost blocks`);
      ghosts.forEach(g => {
        console.log(`  [${g.position_x}, ${g.position_y}, ${g.position_z}] type=${g.block_type}`);
        ghostBlocks.push(g);
      });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total ghost blocks found: ${ghostBlocks.length}`);

  if (ghostBlocks.length > 0) {
    // Group by block_type
    const byType = new Map<string, number>();
    ghostBlocks.forEach(b => {
      byType.set(b.block_type, (byType.get(b.block_type) || 0) + 1);
    });

    console.log('\nBy type:');
    for (const [type, count] of byType) {
      console.log(`  ${type}: ${count}`);
    }

    console.log('\nBlock IDs (for deletion):');
    ghostBlocks.slice(0, 20).forEach(b => console.log(`  ${b.id}`));
    if (ghostBlocks.length > 20) {
      console.log(`  ... and ${ghostBlocks.length - 20} more`);
    }
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
