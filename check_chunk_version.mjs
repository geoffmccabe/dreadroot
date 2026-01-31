import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkChunkVersion() {
  // Tree at -39, 0, 88
  // Chunk X = floor(-39 / 16) = -3
  // Chunk Z = floor(88 / 16) = 5
  const chunkX = -3;
  const chunkZ = 5;

  console.log(`\n=== Checking chunk (${chunkX}, ${chunkZ}) ===\n`);

  // Get the world ID first
  const { data: trees } = await supabase
    .from('planted_trees')
    .select('world_id')
    .eq('base_x', -39)
    .eq('base_z', 88)
    .limit(1);

  if (!trees || trees.length === 0) {
    console.log('No tree found');
    return;
  }

  const worldId = trees[0].world_id;
  console.log(`World ID: ${worldId}`);

  // Check chunk_versions table
  const { data: versions, error: vErr } = await supabase
    .from('chunk_versions')
    .select('*')
    .eq('world_id', worldId)
    .eq('chunk_x', chunkX)
    .eq('chunk_z', chunkZ);

  if (vErr) {
    console.log('Error:', vErr.message);
    return;
  }

  if (!versions || versions.length === 0) {
    console.log('NO CHUNK VERSION ENTRY - cache will always be considered fresh!');
  } else {
    console.log('Chunk version:', versions[0].version);
    console.log('Updated at:', versions[0].updated_at);
  }

  // Count blocks in this chunk
  const { data: blocks, count } = await supabase
    .from('placed_blocks')
    .select('*', { count: 'exact' })
    .eq('world_id', worldId)
    .eq('chunk_x', chunkX)
    .eq('chunk_z', chunkZ)
    .limit(1);

  console.log(`\nBlocks in chunk (${chunkX}, ${chunkZ}): ${count}`);

  // Also check adjacent chunks
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const cx = chunkX + dx;
      const cz = chunkZ + dz;

      const { count: c } = await supabase
        .from('placed_blocks')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId)
        .eq('chunk_x', cx)
        .eq('chunk_z', cz);

      console.log(`  Chunk (${cx}, ${cz}): ${c || 0} blocks`);
    }
  }
}

checkChunkVersion().catch(console.error);
