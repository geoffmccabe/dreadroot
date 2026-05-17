// One-time repair: materialize missing tree blocks from tree_blueprints into
// placed_blocks. Runs via PostgREST with the service_role key (bypasses RLS),
// per-tree, batched, idempotent (on_conflict ignore-duplicates). No SQL editor
// / gateway timeout involved.
//
//   node scripts/backfill-tree-blocks.mjs <world_id>
//
// Reads SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL from .env.

import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; })
);
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const WORLD = process.argv[2] || '0a407a30-9d6a-426c-8114-b8a17096773a';
if (!URL_BASE || !KEY) { console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const BATCH = 400;            // small INSERT statements → small trigger transition tables
const BATCH_PAUSE_MS = 500;   // pace so a small compute instance isn't spiked
const TREE_PAUSE_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPE_CODE = {
  trunk:'t', branch:'b', leaf:'l', spike:'s', nob:'n', cross:'x', fruit:'f',
  invisiblock:'ib', shroom:'sm', shroom_stem:'ss', shroom_cap:'sc',
  fungal_stem:'fs', fungal_cap_top:'fct', fungal_cap_underside:'fcu',
  glow_bark:'gb', root:'r', shrine:'sh',
};
function textureFor(t, sd) {
  const trunk = sd.trunk_texture_url, branch = sd.branch_texture_url, fruit = sd.fruit_texture_url;
  const fs = sd.fungal_stem_texture_url, fct = sd.fungal_cap_top_texture_url, fcu = sd.fungal_cap_underside_texture_url;
  switch (t) {
    case 'trunk': return trunk;
    case 'branch': case 'spike': case 'nob': case 'cross':
    case 'shroom_stem': case 'shroom_cap': case 'glow_bark': return branch ?? trunk;
    case 'leaf': case 'fruit': return fruit ?? branch ?? trunk;
    case 'fungal_stem': return fs ?? trunk;
    case 'fungal_cap_top': return fct ?? fs ?? trunk;
    case 'fungal_cap_underside': return fcu ?? fs ?? trunk;
    case 'root': return trunk ?? branch;
    case 'invisiblock': return null;
    default: return trunk;
  }
}

async function getJSON(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}

async function insertChunk(rows) {
  const r = await fetch(
    `${URL_BASE}/rest/v1/placed_blocks?on_conflict=world_id,position_x,position_y,position_z`,
    { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows), signal: AbortSignal.timeout(45000) }
  );
  if (!r.ok) throw new Error(`POST -> ${r.status} ${(await r.text()).slice(0,300)}`);
}

const trees = await getJSON(
  `planted_trees?select=id,world_id,planted_by,seed_definitions(tier,trunk_texture_url,branch_texture_url,fruit_texture_url,fungal_stem_texture_url,fungal_cap_top_texture_url,fungal_cap_underside_texture_url)` +
  `&world_id=eq.${WORLD}&is_fully_grown=eq.true`
);
console.log(`Trees to process: ${trees.length}`);

let totalInserted = 0;
for (let ti = 0; ti < trees.length; ti++) {
  const tree = trees[ti];
  const sd = tree.seed_definitions;
  if (!sd) { console.log(`  [${ti+1}/${trees.length}] ${tree.id.slice(0,8)} — no seed def, skip`); continue; }
  let bp;
  try {
    const rec = await getJSON(`tree_blueprints?select=blueprint_data&planted_tree_id=eq.${tree.id}`);
    bp = rec?.[0]?.blueprint_data;
  } catch (e) { console.log(`  [${ti+1}/${trees.length}] blueprint fetch failed: ${e.message}`); continue; }
  const blocks = bp?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) { console.log(`  [${ti+1}/${trees.length}] ${tree.id.slice(0,8)} — empty blueprint`); continue; }

  const rows = blocks.map(b => ({
    world_id: tree.world_id,
    user_id: tree.planted_by,
    position_x: b.x | 0, position_y: b.y | 0, position_z: b.z | 0,
    block_type: `${TYPE_CODE[b.type] || 't'}_${b.branchDepth ?? 0}_${sd.tier}`,
    texture_url: textureFor(b.type, sd),
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    let tries = 0;
    while (true) {
      try { await insertChunk(chunk); break; }
      catch (e) { if (++tries >= 4) throw e; await sleep(2000 * tries); }
    }
    inserted += chunk.length;
    await sleep(BATCH_PAUSE_MS);
  }
  totalInserted += inserted;
  console.log(`  [${ti+1}/${trees.length}] ${tree.id.slice(0,8)} — ${rows.length} blocks submitted (running total ${totalInserted})`);
  await sleep(TREE_PAUSE_MS);
}
console.log(`DONE. Submitted ${totalInserted} blueprint blocks across ${trees.length} trees (duplicates auto-skipped).`);
