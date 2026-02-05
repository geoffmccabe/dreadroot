/**
 * Delete ghost blocks with invalid depth values
 * These are broken tree blocks that can't render properly
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODU0ODA0MywiZXhwIjoyMDc0MTI0MDQzfQ.cn5mzW8NONwHbWfndrta_yISvYsKMELAw3YzAekVB5s";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Ghost block IDs found earlier (blocks with negative depth like t_-1_1)
const GHOST_BLOCK_IDS = [
  'ea19de6c-c171-4d51-b9dd-806924cf0a64',
  '8bb890c6-4c07-45f7-a557-7ec156cd3ca9',
  '67a730b0-d34a-4bfb-b650-1cd6f9a6a5cc',
  '17adb472-95cd-4f6f-a775-24e43c704fda',
  'a499b204-3312-42c3-96bf-2f699e3705fe',
  '87db0bed-0ef0-4219-ab33-9bb80b7cbee4',
  'f2cffac1-77ac-4ca0-895e-a7a6fc970aa6',
  'e4a7894e-5390-47ad-a675-868cdc493ee5'
];

async function main() {
  console.log('=== DELETE GHOST BLOCKS ===\n');

  // First, verify these blocks exist and show their details
  console.log('Verifying blocks before deletion...\n');

  const { data: blocks, error: fetchError } = await supabase
    .from('placed_blocks')
    .select('id, position_x, position_y, position_z, block_type, user_id')
    .in('id', GHOST_BLOCK_IDS);

  if (fetchError) {
    console.error('Error fetching blocks:', fetchError);
    return;
  }

  console.log(`Found ${blocks?.length || 0} of ${GHOST_BLOCK_IDS.length} ghost blocks:`);
  blocks?.forEach(b => {
    console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] type=${b.block_type} owner=${b.user_id?.slice(0,8)}...`);
  });

  if (!blocks || blocks.length === 0) {
    console.log('\nNo ghost blocks found - they may have already been deleted.');
    return;
  }

  // Delete the blocks
  console.log('\nDeleting ghost blocks...');

  const { error: deleteError, count } = await supabase
    .from('placed_blocks')
    .delete()
    .in('id', GHOST_BLOCK_IDS);

  if (deleteError) {
    console.error('Delete error:', deleteError);
    return;
  }

  console.log(`✓ Deleted ${blocks.length} ghost blocks`);

  // Verify deletion
  const { data: remaining } = await supabase
    .from('placed_blocks')
    .select('id')
    .in('id', GHOST_BLOCK_IDS);

  console.log(`✓ Verified: ${remaining?.length || 0} blocks remaining (should be 0)`);

  // Note: Not returning to inventory because these are broken tree blocks
  // with invalid depth values - they're not real placeable items
  console.log('\nNote: These ghost blocks were corrupted tree blocks (invalid depth).');
  console.log('They were not returned to inventory as they are not valid items.');

  console.log('\n=== DONE ===');
}

main().catch(console.error);
