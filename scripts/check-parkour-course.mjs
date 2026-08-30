/**
 * Drive the real game through every parkour case and report what happened.
 *
 * Four walls (1, 2, 3 and 4 blocks tall), one per compass direction, crossed
 * with walk/run and jump/no-jump. Sixteen attempts, each one recorded as a
 * timeline of pose, parkour move and height, so a wrong ANIMATION and a wrong
 * MEASUREMENT are told apart without anyone watching the screen.
 *
 *   npm run check:course
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// ITS OWN PROFILE. A second Claude co-builds this repo and runs the game from
// the shared .perftest profile; Chrome refuses to open one profile twice, so a
// shared directory means whichever of us starts second simply fails.
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile-course');
const URL_ = process.env.CHECK_URL ?? 'http://localhost:8080/?perftest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  // HEADLESS BY DEFAULT. A visible Chrome running this game competes for the
  // GPU with the window Geoff is actually testing in — the game is GPU-bound,
  // so a headed checker actively degrades the thing being measured. SHOW=1 to
  // watch it. (Agreed with the other session, which did the same to its three.)
  headless: !process.env.SHOW, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));

await page.goto(URL_, { waitUntil: 'domcontentloaded' });

// KEEP CLICKING UNTIL THE GAME IS ACTUALLY UP. The old fixed-length loops
// assumed the button appears within ten seconds and the world streams within
// ninety, and when either was slower the run carried on against a menu screen
// and reported every hook as missing. Poll for the thing we actually need —
// the dev hooks — and click START GAME whenever it is on screen.
let booted = false;
for (let i = 0; i < 180; i++) {
  const btn = page.getByRole('button', { name: /START GAME|LOGIN/i }).first();
  if (await btn.count().catch(() => 0)) await btn.click({ timeout: 3000 }).catch(() => {});
  if (await page.evaluate(() => typeof window.__parkourCourse === 'object'
    && typeof window.__perfTestControls === 'object').catch(() => false)) { booted = true; break; }
  await sleep(1000);
}
if (!booted) {
  console.log('NEVER BOOTED. body:', await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '?'));
  console.log('errors:', errors.slice(0, 5));
  await ctx.close(); process.exit(1);
}
// The world still has to stream in far enough that the collision grid is real.
await page.waitForFunction(() => !!window.__perfTestReady, null, { timeout: 120000 }).catch(() => {});
await sleep(4000);

const ready = await page.evaluate(() => ({
  course: typeof window.__parkourCourse === 'object',
  controls: typeof window.__perfTestControls === 'object',
  probe: typeof window.__parkour === 'function',
}));
if (!ready.course || !ready.controls || !ready.probe) {
  console.log('MISSING HOOKS:', JSON.stringify(ready));
  console.log('perftestReady:', await page.evaluate(() => !!window.__perfTestReady).catch(() => 'err'));
  console.log('canvas       :', await page.evaluate(() => !!document.querySelector('canvas')).catch(() => 'err'));
  console.log('body text    :', (await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => 'err')));
  console.log('errors       :', errors.slice(0, 5));
  await ctx.close(); process.exit(1);
}

// Is the body even recording? Without this the whole run reports 'no clips'
// and there is no way to tell a broken avatar from a broken animation.
const avatarOk = await page.evaluate(async () => {
  const dbg = await import('/src/components/siege/charAnimDebug.ts');
  const s = dbg.getCharSnap();
  return { recording: !!s, sample: s ? { clip: s.clip, state: s.state } : null,
           avatarHook: typeof window.__avatar === 'object' ? window.__avatar.get() : 'none' };
});
console.log('\navatar recording:', JSON.stringify(avatarOk));

const course = await page.evaluate(() => window.__parkourCourse.build());
console.log('\n=== PARKOUR COURSE ===');
console.log('centre:', JSON.stringify(course.centre));
console.log('walls :', course.walls.map((w) => `${w.dir}=${w.height}b`).join('  '));

/** Put the player back at the centre, on the floor, facing `yaw`. */
async function reset(yaw) {
  // Wait for the control surface rather than assuming it. It is assigned during
  // a React render, so it can briefly disappear across one.
  await page.waitForFunction(() => typeof window.__perfTestControls === 'object', null, { timeout: 15000 });
  await page.evaluate(({ c, yaw }) => {
    const C = window.__perfTestControls;
    // Eye height is added by the controller; +2 so the drop settles them onto
    // the course floor rather than starting them intersecting it.
    C.setPosition(c.x, c.y + 2, c.z);
    C.setYaw(yaw);
  }, { c: course.centre, yaw });
  await sleep(700);
}

/** Sample pose + position 20 times over ~2s while the keys are held. */
async function record(ms = 2000) {
  const frames = [];
  const step = 100;
  for (let i = 0; i < ms / step; i++) {
    const f = await page.evaluate(async () => {
      const m = await import('/src/components/siege/charAnimDebug.ts');
      const s = m.getCharSnap();
      const p = window.__parkour();
      return s ? {
        clip: s.clip, state: s.state, move: s.move,
        y: +s.y.toFixed(2), vy: +s.vy.toFixed(2), grounded: s.grounded,
        ahead: p.reading ? +p.reading.height.toFixed(2) : null,
      } : null;
    }).catch(() => null);
    if (f) frames.push(f);
    await sleep(step);
  }
  return frames;
}

/** One attempt: face a wall, hold the keys, report the timeline. */
async function attempt(wall, { run, jump }) {
  await reset(wall.yaw);
  const feetNow = () => page.evaluate(() => window.__parkour().feet ?? null).catch(() => null);
  let before = await feetNow();
  for (let i = 0; i < 10 && !before; i++) { await sleep(200); before = await feetNow(); }
  before = before ?? { x: 0, y: 0, z: 0 };
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  // PRESS JUMP WHEN THE WALL IS ACTUALLY IN REACH, not on a timer. A fixed
  // delay makes the result depend on frame rate: the same case fired a mantle
  // on one run and a plain jump on the next, purely because the approach took
  // a few frames longer. Poll the scanner and press when it sees something.
  if (jump) {
    await page.waitForFunction(() => {
      const p = window.__parkour();
      return !!(p && p.reading);
    }, null, { timeout: 6000 }).catch(() => {});
    await page.keyboard.down('Space');
  } else {
    await sleep(900);
  }
  const frames = await record(1800);
  if (jump) await page.keyboard.up('Space');
  await page.keyboard.up('w');
  if (run) await page.keyboard.up('Shift');
  const after = (await feetNow()) ?? before;

  // Why nothing happened is the whole question, so carry the refusal reason
  // and the raw sample count out of every attempt rather than only the summary.
  const diag = await page.evaluate(() => {
    const p = window.__parkour();
    return {
      lastAttempt: (p.lastAttempt || '').split('\n').slice(-3).join(' | '),
      reading: p.reading ? { h: p.reading.height, d: p.reading.distance } : null,
      feet: p.feet, forward: p.forward,
    };
  }).catch(() => null);
  const snapOk = frames.length > 0 && frames.some((f) => f.clip && !f.clip.startsWith('(none'));
  if (!snapOk) console.log(`  [${wall.height}b ${run ? 'run' : 'walk'} ${jump ? 'jump' : 'nojump'}] frames=${frames.length} snap=${frames[0] ? JSON.stringify(frames[0]) : 'NULL'} diag=${JSON.stringify(diag)}`);

  const clips = [...new Set(frames.map((f) => f.clip))];
  const moves = [...new Set(frames.map((f) => f.move).filter(Boolean))];
  const maxY = Math.max(...frames.map((f) => f.y), before.y);
  const restPose = frames.some((f) => f.clip.startsWith('(none'));
  return {
    label: `${wall.height}-block ${run ? 'RUN ' : 'walk'} ${jump ? 'jump' : 'no-jump'}`,
    fromY: before.y, toY: after.y, maxY: +maxY.toFixed(2),
    climbed: +(after.y - before.y).toFixed(2),
    overshoot: +(maxY - wall.height).toFixed(2),
    moves, restPose,
    clips: clips.map((c) => c.replace(/Anim_Parkour_|Anim_|_NoSkin|Loco_[MF]_/g, '')),
  };
}

const results = [];
for (const wall of course.walls) {
  for (const run of [false, true]) {
    for (const jump of [false, true]) {
      results.push(await attempt(wall, { run, jump }));
    }
  }
}
await page.evaluate(() => window.__parkourCourse.clear());

console.log('\n=== RESULTS ===');
console.log('case                       climbed  peak  over  parkour move        rest-pose  clips');
for (const r of results) {
  console.log(
    `${r.label.padEnd(26)} ${String(r.climbed).padStart(6)} ${String(r.maxY).padStart(5)} ` +
    `${String(r.overshoot).padStart(5)}  ${(r.moves.join(',') || '—').padEnd(19)} ` +
    `${r.restPose ? 'T-POSE!' : 'ok     '}   ${r.clips.join(' > ')}`,
  );
}

// Overshoot only counts when a PARKOUR MOVE was responsible. Standing on top
// of a one-block wall and pressing jump legitimately reaches a metre above it,
// and flagging that is crying wolf at correct behaviour.
const bad = results.filter((r) => r.restPose || (r.moves.length && r.overshoot > 0.5));
console.log(`\npage errors: ${errors.length}`);
errors.slice(0, 3).forEach((e) => console.log('  ', e));
const noMove = results.filter((r) => !r.moves.length);
console.log(`\ncases with NO parkour move: ${noMove.length}/16 — ${noMove.map((r) => r.label).join('; ') || 'none'}`);
console.log(bad.length
  ? `\nRESULT: ${bad.length} case(s) look wrong — ${bad.map((r) => r.label + (r.restPose ? ' (REST POSE)' : ` (+${r.overshoot}m over)`)).join('; ')}`
  : '\nRESULT: no rest poses, and every parkour move ended at the height of the wall it climbed.');
await ctx.close();
