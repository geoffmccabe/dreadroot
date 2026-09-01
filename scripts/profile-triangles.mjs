/**
 * Names the triangles. D-Flow reports a total; a total is not actionable.
 *   npm run profile:tris        (SHOW=1 to watch)
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext(path.join(ROOT, '.perftest', 'chrome-profile-tris'), {
  headless: !process.env.SHOW, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

/**
 * Get past the sign-in gate.
 *
 * These checks used to ride on a stored session in the browser profile. That broke
 * the moment the profile was copied for parallel harnesses: Supabase ROTATES the
 * refresh token, so two copies of one session invalidate each other and every check
 * afterwards reports "no canvas" for a reason that has nothing to do with the code.
 *
 * Signing in as a guest instead makes the harness self-sufficient — no shared
 * credential to expire, burn or leak.
 */
async function enterGame(page, sleep) {
  for (let i = 0; i < 30; i++) {
    const start = page.getByRole('button', { name: /START GAME/i }).first();
    if (await start.count().catch(() => 0)) { await start.click({ timeout: 5000 }).catch(() => {}); return; }
    const guest = page.getByRole('button', { name: /PLAY WITHOUT ACCT|STARTING/i }).first();
    if (await guest.count().catch(() => 0)) { await guest.click({ timeout: 5000 }).catch(() => {}); await sleep(3000); continue; }
    await sleep(500);
  }
}

await page.goto('http://localhost:8080/?perftest', { waitUntil: 'domcontentloaded' });
await enterGame(page, sleep);
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!window.__perftestReady).catch(() => false)) break;
  await sleep(1000);
}
await sleep(8000);
// diagnosticsLogger already attributes triangles to named meshes (captureSceneGeometry); it just
// needs a recording running. window.__d is the logger itself.
const out = await page.evaluate(async () => {
  const d = window.__d;
  if (!d) return { error: 'window.__d missing' };
  d.enabled = true;
  await new Promise((r) => setTimeout(r, 4000));   // its scan is throttled to once a second
  const b = d.geometryBuckets;
  if (!b || b.size === 0) return { error: 'geometryBuckets empty — captureSceneGeometry never ran' };
  let total = 0;
  for (const [, v] of b) total += v.tris;
  return {
    totalTris: Math.round(total), meshes: b.size,
    top: [...b.entries()].sort((x, y) => y[1].tris - x[1].tris).slice(0, 25)
      .map(([name, v]) => ({ name, tris: Math.round(v.tris), objects: v.draws, instances: v.instances,
        pct: +(100 * v.tris / (total || 1)).toFixed(1) })),
  };
});
if (out.error) console.log(out.error);
else {
  console.log(`\nTOTAL ${(out.totalTris / 1000).toFixed(1)}K triangles across ${out.meshes} meshes` +
              `  (hidden, not drawn: ${(out.hiddenTris / 1000).toFixed(1)}K)\n`);
  console.log('  tris      %    objects  instances  name');
  for (const r of out.top) {
    console.log(`  ${String((r.tris / 1000).toFixed(1) + 'K').padStart(8)} ${String(r.pct).padStart(5)}%` +
                ` ${String(r.objects).padStart(8)} ${String(r.instances).padStart(10)}  ${r.name}`);
  }
}
await page.screenshot({ path: process.env.SHOT ?? '/tmp/tris.png' });
console.log('screenshot:', process.env.SHOT ?? '/tmp/tris.png');
await ctx.close();
