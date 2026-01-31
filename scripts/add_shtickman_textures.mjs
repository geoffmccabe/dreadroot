// Quick script to add bamboo textures to shtickman definitions
// Run with: node scripts/add_shtickman_textures.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse .env file manually
const envPath = join(__dirname, '../.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    // Remove quotes from value
    let value = valueParts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key.trim()] = value;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Setting up shtickman definitions with bamboo textures...');

  // First, check if the table exists by trying to select
  const { data: existing, error: checkError } = await supabase
    .from('shtickman_definitions')
    .select('tier')
    .limit(1);

  if (checkError && checkError.message.includes('Could not find')) {
    console.log('Table does not exist. Please run the migration first:');
    console.log('  supabase/migrations/20260127120000_create_shtickman_definitions.sql');
    console.log('Or create the table via Supabase Dashboard SQL editor.');
    process.exit(1);
  }

  // Check if we have any rows
  const { data: rows, error: countError } = await supabase
    .from('shtickman_definitions')
    .select('tier');

  if (countError) {
    console.error('Error checking table:', countError.message);
    process.exit(1);
  }

  // If no rows, insert all 10 tiers
  if (!rows || rows.length === 0) {
    console.log('No existing definitions found. Inserting 10 tiers...');

    const inserts = [];
    for (let tier = 1; tier <= 10; tier++) {
      inserts.push({
        tier,
        name: 'Shtickman',
        body_texture_url: `/Bamboo_Seamless_t${tier}.webp`,
        speed: 3.0 + (tier - 1) * 0.1,
        health: 300 + (tier - 1) * 50,
        damage_per_hit: 0,
        knockback_received: 1.0,
      });
    }

    const { error: insertError } = await supabase
      .from('shtickman_definitions')
      .insert(inserts);

    if (insertError) {
      console.error('Error inserting:', insertError.message);
      process.exit(1);
    }

    console.log('Inserted 10 tiers with bamboo textures!');
  } else {
    // Update existing rows
    console.log(`Found ${rows.length} existing definitions. Updating textures...`);

    for (let tier = 1; tier <= 10; tier++) {
      const textureUrl = `/Bamboo_Seamless_t${tier}.webp`;

      const { error } = await supabase
        .from('shtickman_definitions')
        .update({ body_texture_url: textureUrl })
        .eq('tier', tier);

      if (error) {
        console.error(`Error updating tier ${tier}:`, error.message);
      } else {
        console.log(`Tier ${tier}: ${textureUrl}`);
      }
    }
  }

  console.log('Done!');
}

main().catch(console.error);
