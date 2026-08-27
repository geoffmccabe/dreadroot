/**
 * Does the character lineup tool open in the pose we think it does?
 *
 * It is keyboard-only, lives inside the Canvas, and has no DOM — so "it opened
 * holding a rifle" was only discoverable by a human looking at it. Twice. This
 * boots the real app, presses "&&&", and reports the weapon, the clip and the
 * ground height the tool actually chose.
 *
 *   npm run check:lineup
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
// Let the world stream in far enough that the collision grid has ground in it —
// the lineup's feet are placed off that grid.
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => !!document.querySelector('canvas')).catch(() => false)) break;
  await sleep(500);
}
// The lineup stands on the block collision grid, so the world has to have
// streamed in before the anchor is taken. Init measured ~19s.
for (let i = 0; i < 90; i++) {
  if (await page.evaluate(() => !!window.__perftestReady).catch(() => false)) break;
  await sleep(1000);
}
await sleep(4000);

// Dispatch "&" straight at the window rather than typing it: the listener is a
// capture-phase window handler, and a real keypress depends on the browser's
// keyboard layout mapping Shift+7, which is not something this check should be
// testing.
await page.evaluate(() => {
  for (let i = 0; i < 3; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '&', code: 'Digit7', shiftKey: true, bubbles: true }));
  }
});
await sleep(6000);

const st = await page.evaluate(() => (window.__lineup ? window.__lineup() : null));
const probe = await page.evaluate((s) => {
  if (!window.__lineupProbe || !s) return null;
  return { row: window.__lineupProbe(s.anchorX, s.anchorZ, s.anchorY + 5) };
}, st);
if (probe) console.log('probe     :', JSON.stringify(probe));
console.log('\n=== LINEUP CHECK ===');
console.log(st ? JSON.stringify(st, null, 2) : 'window.__lineup MISSING — state module never loaded');
if (errors.length) { console.log('page errors:'); for (const e of errors.slice(0, 5)) console.log('  -', e.slice(0, 200)); }
await page.screenshot({ path: process.env.SHOT ?? '/tmp/lineup.png' });
console.log('screenshot :', process.env.SHOT ?? '/tmp/lineup.png');
await ctx.close();

if (!st?.enabled) { console.log('\nRESULT: the lineup did NOT open.'); process.exit(1); }
console.log(st.clip && st.clip.startsWith('pistol_')
  ? '\nRESULT: opened in a PISTOL pose.'
  : `\nRESULT: WRONG POSE — clip is "${st.clip}".`);
