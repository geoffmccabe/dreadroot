/**
 * Verify block ownership after update attempt
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ditecxjpkgbqkeckebzb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdGVjeGpwa2dicWtlY2tlYnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDgwNDMsImV4cCI6MjA3NDEyNDA0M30.8R0HFzo1BAf5MvfwC9g8wJnHefeTZxtbOcKioIt-1w4";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const blockIds = [
  '8b8a4b51-d1d9-48ed-a1ae-40fda3296e8a',
  '316eb4a5-2bcf-4ebb-a299-9649e18e1be0',
  'fa837c44-d21f-4415-a993-af7718ed72ef',
  'd32bf0d9-7bf0-481a-8f8b-ee59ce40bd07',
  '144a05c7-9105-4663-86d5-5c975bfec51a',
  '92f72d9d-5865-4ab0-95e5-c2ed27f750b8',
  '6d74298e-7eb6-4897-8fe3-79f87eab6ae6'
];

async function main() {
  console.log('=== VERIFY BLOCK OWNERSHIP ===\n');

  const { data: blocks, error } = await supabase
    .from('placed_blocks')
    .select('id, user_id, position_x, position_y, position_z')
    .in('id', blockIds);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Current block ownership:');
  blocks?.forEach(b => {
    console.log(`  [${b.position_x}, ${b.position_y}, ${b.position_z}] user=${b.user_id}`);
  });

  const ghostUser = '27568303-1e35-4ef5-8867-56e2e4e07061';
  const targetUser = 'acd04cb5-f592-44b1-8fc1-1f1cf70624c7';

  const stillGhost = blocks?.filter(b => b.user_id === ghostUser).length || 0;
  const nowTarget = blocks?.filter(b => b.user_id === targetUser).length || 0;

  console.log(`\nStill owned by ghost: ${stillGhost}`);
  console.log(`Now owned by target: ${nowTarget}`);

  console.log('\n=== DONE ===');
}

main().catch(console.error);
