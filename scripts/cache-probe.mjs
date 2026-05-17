// Warm-revisit probe: does the IndexedDB chunk cache actually serve
// revisited chunks, or does it refetch from Supabase anyway?
// Phase A roams a SMALL fixed circle to populate the cache (no sampling).
// Phase B roams the SAME circle again (pure revisit) with allocation
// sampling + console capture of the loader's cache hit/miss logs.
//   - supabase% collapses in B  -> cache works (ClearSession was the bug)
//   - supabase% stays ~50% in B -> cache read/freshness is broken (next fix)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_URL = 'http://localhost:8080/?perftest';
const AUTH = path.join(ROOT, '.perftest', 'auth.json');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

if (fs.existsSync(AUTH)) {
  const s = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  await ctx.addCookies(s.cookies || []);
  if (s.origins?.[0]?.localStorage) {
    await page.goto('http://localhost:8080/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate((it) => { for (const i of it) localStorage.setItem(i.name, i.value); }, s.origins[0].localStorage);
  }
}

const cacheLogs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/Loaded from cache|Loaded from server|Cache:.*hits|Cache trusted|Cache freshness|Fetch complete/.test(t)) cacheLogs.push(t);
});

await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => window.__perfTestReady === true).catch(() => false)) break;
  await sleep(500);
}
await page.evaluate(() => window.__perfTestControls?.enableGodMode?.()).catch(() => {});
await sleep(1500);
const s0 = await page.evaluate(() => window.__perfTestControls?.getPosition?.() ?? { x: 0, z: 0 });

const roam = async (secs) => {
  const ticks = secs * 10;
  for (let t = 0; t < ticks; t++) {
    const a = (t / ticks) * Math.PI * 2 * 3; // 3 laps, FIXED small circle
    await page.evaluate((p) => {
      const c = window.__perfTestControls;
      c?.setPosition?.(p.x, 45, p.z); c?.setYaw?.(p.yaw);
    }, { x: s0.x + 55 * Math.cos(a), z: s0.z + 55 * Math.sin(a), yaw: a }).catch(() => {});
    await sleep(100);
  }
};

console.log('[cache] Phase A: warming the area (20s)...');
await roam(20);
await sleep(2000); // let cache writes settle
cacheLogs.length = 0; // only count Phase B

const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
console.log('[cache] Phase B: REVISITING same area (25s, sampled)...');
await roam(25);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
await ctx.close();

const agg = new Map(); let total = 0;
(function w(n) {
  const f = n.callFrame || {};
  const k = `${f.functionName || '(anon)'}  @${(f.url || '').split('/').pop()}:${(f.lineNumber ?? 0) + 1}`;
  if (n.selfSize) { total += n.selfSize; agg.set(k, (agg.get(k) || 0) + n.selfSize); }
  (n.children || []).forEach(w);
})(profile.head);
const sup = [...agg.entries()].filter(([k]) => /supabase/.test(k)).reduce((s, [, b]) => s + b, 0);
console.log(`\n=== PHASE B (revisit) total ${(total / 1048576).toFixed(1)} MB ===`);
for (const [k, b] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
  console.log(`  ${(b / 1048576).toFixed(1).padStart(7)} MB  ${(100 * b / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`\nsupabase share on REVISIT: ${(100 * sup / total).toFixed(1)}%  (was ~54% exploring new)`);
const fromCache = cacheLogs.filter((l) => /Loaded from cache/.test(l)).length;
const fromServer = cacheLogs.filter((l) => /Loaded from server|Fetch complete/.test(l)).length;
console.log(`loader logs in Phase B: from-cache=${fromCache}  from-server=${fromServer}`);
console.log('sample loader logs:', cacheLogs.slice(0, 8));
