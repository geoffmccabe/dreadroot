// Definitive check: does fetch_chunks_batch still cap at 1000?
// Strategy: find the single densest chunk, RPC just that one chunk
// (small request -> no statement timeout), compare returned count to
// the chunk's true row count.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const URL = 'https://ditecxjpkgbqkeckebzb.supabase.co';
const KEY = 'sb_publishable_poUyHgcsLCsCiZS2lz9Buw_pHZf-vh0';

const auth = JSON.parse(fs.readFileSync('.perftest/auth.json', 'utf8'));
const tok = auth.origins?.[0]?.localStorage?.find(
  (i) => i.name === 'sb-ditecxjpkgbqkeckebzb-auth-token'
)?.value;
const sess = tok ? JSON.parse(tok) : null;

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
if (sess?.access_token && sess?.refresh_token) {
  const { error } = await sb.auth.setSession({
    access_token: sess.access_token,
    refresh_token: sess.refresh_token,
  });
  console.log('auth:', error ? `FAILED (${error.message})` : 'ok');
}

const { data: wb } = await sb.from('placed_blocks').select('world_id').limit(1);
const worldId = wb?.[0]?.world_id ?? null;
console.log('world_id:', worldId ?? '(none)');
if (!worldId) process.exit(1);

// Sample rows to find the modal (densest) chunk — cheap, indexed scan.
const { data: sample, error: sErr } = await sb
  .from('placed_blocks')
  .select('chunk_x,chunk_z')
  .eq('world_id', worldId)
  .limit(8000);
if (sErr) {
  console.log('sample error:', sErr.message);
  process.exit(1);
}
const tally = new Map();
for (const r of sample) {
  const k = `${r.chunk_x},${r.chunk_z}`;
  tally.set(k, (tally.get(k) || 0) + 1);
}
const [bestKey] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
const [cx, cz] = bestKey.split(',').map(Number);
console.log(`densest sampled chunk: (${cx}, ${cz})`);

// True count for that one chunk.
const { count: trueCount, error: cErr } = await sb
  .from('placed_blocks')
  .select('*', { count: 'exact', head: true })
  .eq('world_id', worldId)
  .eq('chunk_x', cx)
  .eq('chunk_z', cz);
if (cErr) console.log('count error:', cErr.message);

// RPC for just that chunk.
const t0 = Date.now();
const { data, error } = await sb.rpc('fetch_chunks_batch', {
  p_world_id: worldId,
  p_chunks: [{ x: cx, z: cz }],
});
if (error) {
  console.log(`RPC ERROR ${error.code || ''} ${error.message}`);
  process.exit(1);
}
const n = Array.isArray(data) ? data.length : -1;
console.log(`true count for chunk: ${trueCount}`);
console.log(`RPC returned        : ${n}  (${Date.now() - t0}ms)`);
console.log(`sample keys         : ${n > 0 ? Object.keys(data[0]).join(',') : '(none)'}`);

if (n === trueCount && n > 1000) {
  console.log(`\n✅ PASS — RPC returned all ${n} (>1000) blocks. RETURNS jsonb is LIVE, cap is gone.`);
} else if (n === trueCount) {
  console.log(`\n✅ MATCH but only ${n} blocks (<=1000) — not a strict proof. Densest chunk is small; cap can't be ruled in or out from this. Likely fine since counts match exactly.`);
} else if (n === 1000 && trueCount > 1000) {
  console.log(`\n❌ FAIL — RPC capped at exactly 1000 while chunk truly has ${trueCount}. Old RETURNS TABLE still live.`);
} else {
  console.log(`\n⚠️ Mismatch: RPC ${n} vs true ${trueCount}. Investigate.`);
}
