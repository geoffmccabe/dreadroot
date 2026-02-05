/**
 * Fix fortress block ownership - transfer to specified user
 *
 * Usage: npx tsx scripts/fix-fortress-ownership.ts <YOUR_USER_ID>
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
// Use service role key to bypass RLS
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODU0ODA0MywiZXhwIjoyMDc0MTI0MDQzfQ.cn5mzW8NONwHbWfndrta_yISvYsKMELAw3YzAekVB5s";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Known values from previous queries
const MAGOR_WORLD_ID = 'def654df-0d47-44be-8d40-821f5ad1c3db';
const DEFAULT_WORLD_ID = '0a407a30-9d6a-426c-8114-b8a17096773a';
const GHOST_USER = '27568303-1e35-4ef5-8867-56e2e4e07061';

// Likely superadmin user found in Default World
const LIKELY_SUPERADMIN = 'acd04cb5-f592-44b1-8fc1-1f1cf70624c7';

async function main() {
  const targetUserId = process.argv[2] || LIKELY_SUPERADMIN;

  console.log('=== FIX FORTRESS BLOCK OWNERSHIP ===\n');

  // 1. Find the orphan fortress blocks using world_id (indexed)
  const { data: orphanBlocks, error: obErr } = await supabase
    .from('placed_blocks')
    .select('id, position_x, position_y, position_z, block_type, world_id, user_id, chunk_x, chunk_z')
    .eq('world_id', MAGOR_WORLD_ID)
    .eq('chunk_x', -1)
    .eq('chunk_z', 2)
    .limit(100);

  if (obErr) {
    console.error('Error finding orphan blocks:', obErr);
    return;
  }

  // Filter for fortress_blocks owned by ghost user
  const fortressOrphans = orphanBlocks?.filter(
    b => b.block_type === 'fortress_block' && b.user_id === GHOST_USER
  ) || [];

  console.log(`Found ${fortressOrphans.length} orphan fortress_blocks:`);
  fortressOrphans.forEach(b => {
    console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] id=${b.id}`);
  });

  if (fortressOrphans.length === 0) {
    console.log('No orphan fortress blocks to fix.');
    return;
  }

  // Validate target user ID format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(targetUserId)) {
    console.error('Invalid user ID format. Expected UUID.');
    return;
  }

  console.log(`\nTransferring ${fortressOrphans.length} blocks to user: ${targetUserId}`);

  // 2. Update ownership
  const blockIds = fortressOrphans.map(b => b.id);
  const { error: updateErr, count } = await supabase
    .from('placed_blocks')
    .update({ user_id: targetUserId })
    .in('id', blockIds);

  if (updateErr) {
    console.error('Update error:', updateErr);
    return;
  }

  console.log(`✓ Successfully updated ${fortressOrphans.length} blocks!`);

  // 3. Verify the update
  const { data: verifyBlocks } = await supabase
    .from('placed_blocks')
    .select('id, user_id')
    .in('id', blockIds);

  const verified = verifyBlocks?.filter(b => b.user_id === targetUserId).length || 0;
  console.log(`✓ Verified: ${verified}/${fortressOrphans.length} blocks now owned by target user.`);

  console.log('\n=== DONE ===');
}

main().catch(console.error);
