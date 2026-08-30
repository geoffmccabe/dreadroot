/**
 * What does the parkour scanner actually see?
 *
 * "No parkour ever happens" has five indistinguishable causes from outside the
 * game. This boots the real app, walks forward into whatever is ahead, and
 * prints the scanner's own measurement plus the move it would choose. That
 * turns a report into a number.
 *
 *   npm run check:parkour
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const URL_ = process.env.CHECK_URL ?? 'http://localhost:8080/?perftest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 20; i++) {
  const btn = page.getByRole('button', { name: /START GAME|LOGIN/i }).first();
  if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 5000 }).catch(() => {}); break; }
  await sleep(500);
}
for (let i = 0; i < 90; i++) {
  if (await page.evaluate(() => !!window.__perftestReady).catch(() => false)) break;
  await sleep(1000);
}
await sleep(4000);

// Is the scanner even installed, and what does the collision grid hold?
const base = await page.evaluate(() => {
  const probe = window.__parkour;
  return {
    hookPresent: typeof probe === 'function',
    first: typeof probe === 'function' ? probe() : null,
  };
});
console.log('\n=== PARKOUR CHECK ===');
console.log('hook installed :', base.hookPresent);
if (!base.hookPresent) {
  console.log('\nRESULT: the debug hook never installed — ScannerInstaller did not run.');
  await ctx.close(); process.exit(1);
}
console.log('grid boxes 4m  :', base.first.gridBoxesWithin4m);
console.log('fan @1.1m      :', JSON.stringify(base.first.fan));
console.log('reading @1.1m  :', JSON.stringify(base.first.reading));

// The decisive test. The grid demonstrably holds blocks a few metres away, so a
// LONG scan must find them. If a 6m fan is also empty while the grid is full,
// the scanner is broken; if it finds them, the scanner works and the fault is
// in what triggers it.
const wide = await page.evaluate(() => window.__parkour(6));
console.log('fan @6m        :', JSON.stringify(wide.fan, null, 2));
console.log('reading @6m    :', JSON.stringify(wide.reading));

// Walk forward for a couple of seconds and sample as we go: the interesting
// reading is the one taken while actually approaching something.
await page.mouse.click(640, 360).catch(() => {});
await sleep(400);
const samples = [];
await page.keyboard.down('w');
for (let i = 0; i < 12; i++) {
  await sleep(300);
  const s = await page.evaluate(() => {
    const r = window.__parkour(2.5);
    return { feet: r.feet, reading: r.reading, fan: Object.keys(r.fan || {}).length };
  }).catch(() => null);
  if (s) samples.push(s);
}
// DOES THE TRIGGER EVEN FIRE? Press jump while still walking forward. Whether
// there is a wall here or not, a fired trigger RECORDS an attempt. No record
// means the check that guards it ate the press, which is a different bug in a
// different place from "the scanner saw nothing".
// HELD, not pressed: Playwright's press() is down+up inside ~10ms, which can
// fall entirely between two 60fps frames and never be seen by the movement
// loop. A tap that misses would look identical to a trigger that is broken.
await page.keyboard.down('Space');
await sleep(600);
await page.keyboard.up('Space');
await sleep(200);
await page.keyboard.up('w');
const attempt = await page.evaluate(() => window.__parkour().lastAttempt).catch(() => null);
console.log('\n--- after pressing jump while walking forward ---');
console.log(attempt);

console.log('\nwalk samples:', samples.length);
for (const s of samples) console.log('  ', JSON.stringify(s));
const moved = samples.length > 1 &&
  (samples[0].feet.x !== samples[samples.length - 1].feet.x ||
   samples[0].feet.z !== samples[samples.length - 1].feet.z);
console.log('player actually moved while W was held :', moved);
console.log('feet position updating at all          :', moved ? 'yes' : 'NO — the movement branch that publishes it never ran');

const last = await page.evaluate(() => window.__parkour().lastAttempt).catch(() => null);
console.log('\n' + (last ?? 'no attempt recorded'));
console.log('\npage errors :', errors.length);
errors.slice(0, 3).forEach((e) => console.log('  ', e));

console.log('\nRESULT: see above.');
await ctx.close();
