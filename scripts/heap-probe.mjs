// Heap probe: drive the game into the heavy state, force GC, take a heap
// snapshot, and aggregate RETAINED bytes by object type so we can see what
// the ~900MB actually is (data-driven, not guessing). Reuses the perftest
// persistent profile + saved auth.  Run: node scripts/heap-probe.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_URL = 'http://localhost:8080/?perftest';
const AUTH = path.join(ROOT, '.perftest', 'auth.json');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const OUT = path.join(ROOT, 'perftest-results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// Restore auth (same as perftest)
if (fs.existsSync(AUTH)) {
  const s = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  await ctx.addCookies(s.cookies || []);
  if (s.origins?.[0]?.localStorage) {
    await page.goto('http://localhost:8080/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate((items) => { for (const i of items) localStorage.setItem(i.name, i.value); },
      s.origins[0].localStorage);
  }
}

console.log('[heap] loading game...');
await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});

// Wait for ready
for (let i = 0; i < 120; i++) {
  const r = await page.evaluate(() => (window).__perfTestReady === true).catch(() => false);
  if (r) break;
  await sleep(500);
}
await page.evaluate(() => (window).__perfTestControls?.enableGodMode?.()).catch(() => {});
await sleep(1000);

// Roam a wide area to accumulate loaded chunks / colliders / mesh buffers,
// reproducing the real "288 loaded chunks, ~900MB" state.
console.log('[heap] roaming 50s to accumulate state...');
const start = await page.evaluate(() => (window).__perfTestControls?.getPosition?.() ?? { x: 0, y: 50, z: 0 });
const cx = start.x, cz = start.z;
const R = 160;
for (let t = 0; t < 500; t++) {
  const a = (t / 500) * Math.PI * 6; // a few laps, expanding
  const rad = 40 + (R * t) / 500;
  await page.evaluate((p) => {
    const c = (window).__perfTestControls;
    c?.setPosition?.(p.x, 50, p.z); c?.setYaw?.(p.yaw);
  }, { x: cx + rad * Math.cos(a), z: cz + rad * Math.sin(a), yaw: a + Math.PI / 2 }).catch(() => {});
  await sleep(100);
}

const cdp = await ctx.newCDPSession(page);
const mem = async () => page.evaluate(() => {
  const m = (performance).memory;
  return m ? { usedMB: Math.round(m.usedJSHeapSize / 1048576), totalMB: Math.round(m.totalJSHeapSize / 1048576) } : null;
});
console.log('[heap] before GC:', await mem());
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
await sleep(1500);
console.log('[heap] after forced GC (retained):', await mem());

console.log('[heap] taking snapshot...');
const parts = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => parts.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const snapStr = parts.join('');
fs.mkdirSync(OUT, { recursive: true });
const snapPath = path.join(OUT, `heap-${new Date().toISOString().replace(/[:.]/g, '-')}.heapsnapshot`);
fs.writeFileSync(snapPath, snapStr);
console.log('[heap] snapshot bytes:', snapStr.length, '->', snapPath);
await ctx.close();

// ---- Aggregate retained self_size by type/constructor ----
const snap = JSON.parse(snapStr);
const meta = snap.snapshot.meta;
const nf = meta.node_fields;            // e.g. type,name,id,self_size,edge_count,...
const NT = meta.node_types[0];          // node type names
const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iSize = nf.indexOf('self_size');
const stride = nf.length;
const nodes = snap.nodes, strings = snap.strings;
const byKey = new Map();
let total = 0;
for (let i = 0; i < nodes.length; i += stride) {
  const typeName = NT[nodes[i + iType]] || 'node';
  const sz = nodes[i + iSize];
  total += sz;
  // group objects/arrays by constructor name; others by type bucket
  const key = (typeName === 'object' || typeName === 'native')
    ? `${typeName}:${strings[nodes[i + iName]] || '?'}`
    : typeName;
  const e = byKey.get(key) || { bytes: 0, count: 0 };
  e.bytes += sz; e.count++; byKey.set(key, e);
}
const rows = [...byKey.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 30);
console.log(`\n=== RETAINED HEAP (post-GC) total ${(total / 1048576).toFixed(0)} MB ===`);
for (const [k, v] of rows) {
  console.log(`  ${(v.bytes / 1048576).toFixed(1).padStart(8)} MB  ${String(v.count).padStart(8)}  ${k}`);
}
