import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkChunkColumns() {
  console.log('\n=== Checking chunk_x/chunk_z for tree blocks ===\n');

  // Check the tree at -7, 0, 57 - chunk should be (-1, 3)
  // Expected chunk_x = floor(-7 / 16) = -1
  // Expected chunk_z = floor(57 / 16) = 3

  const { data: blocks, error } = await supabase
    .from('placed_blocks')
    .select('id, position_x, position_y, position_z, chunk_x, chunk_z, block_type')
    .eq('position_x', -7)
    .eq('position_z', 57)
    .limit(10);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`Found ${blocks?.length || 0} blocks at x=-7, z=57`);

  if (blocks && blocks.length > 0) {
    console.log('\nSample blocks:');
    for (const b of blocks) {
      console.log(`  Y=${b.position_y}: type=${b.block_type}, chunk=(${b.chunk_x}, ${b.chunk_z})`);
    }

    // Check if chunk values are correct
    const expectedChunkX = Math.floor(-7 / 16);
    const expectedChunkZ = Math.floor(57 / 16);
    console.log(`\nExpected chunk: (${expectedChunkX}, ${expectedChunkZ})`);

    const wrongChunk = blocks.filter(b => b.chunk_x !== expectedChunkX || b.chunk_z !== expectedChunkZ);
    if (wrongChunk.length > 0) {
      console.log(`\n*** ${wrongChunk.length} BLOCKS HAVE WRONG CHUNK VALUES! ***`);
      for (const b of wrongChunk.slice(0, 5)) {
        console.log(`  ID ${b.id}: has chunk (${b.chunk_x}, ${b.chunk_z}), should be (${expectedChunkX}, ${expectedChunkZ})`);
      }
    } else {
      console.log('\nAll blocks have correct chunk values');
    }
  }

  // Check total tree blocks with null chunk values
  const { data: nullChunks, count } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .is('chunk_x', null)
    .limit(10);

  console.log(`\nBlocks with NULL chunk_x: ${count || 0}`);
  if (nullChunks && nullChunks.length > 0) {
    console.log('Sample null-chunk blocks:');
    for (const b of nullChunks.slice(0, 5)) {
      console.log(`  (${b.position_x}, ${b.position_y}, ${b.position_z}): ${b.block_type}`);
    }
  }

  // Check how many tree blocks exist in chunk (-1, 3)
  const { data: chunkBlocks, count: chunkCount } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('chunk_x', -1)
    .eq('chunk_z', 3)
    .limit(1);

  console.log(`\nTotal blocks in chunk (-1, 3): ${chunkCount || 0}`);
}

checkChunkColumns().catch(console.error);
