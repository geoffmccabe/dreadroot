/**
 * check-kaiju-shouts — the soldiers say things, at the right rate, for the right length of time.
 *
 * Run: npm run check:kaiju-shouts
 */

import * as THREE from 'three';
import {
  SHOUTS, SHOUT_CHANCE, SHOUT_FADE, maybeShout, stepShouts, getShouts, clearShouts, shoutOpacity,
} from '../src/components/siege/globe/kaijuShouts';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== The soldiers have something to say ==\n');

// --- THE LINES -----------------------------------------------------------------------------------
ok(SHOUTS.length >= 100, 'there are at least a hundred lines', `${SHOUTS.length}`);
ok(SHOUTS.every((l) => l.trim().length > 0), 'none of them is empty');
ok(new Set(SHOUTS).size === SHOUTS.length, 'none of them is a duplicate',
   `${SHOUTS.length - new Set(SHOUTS).size} repeats`);
// A line long enough to need six or seven wrapped rows would not fit a bubble 10 m by 6 m however
// small the type went. This is the ceiling the text layout can actually cope with.
const longest = SHOUTS.reduce((m, l) => (l.length > m.length ? l : m), '');
ok(longest.length <= 70, 'the longest line still fits a bubble', `${longest.length} chars: "${longest}"`);

// --- HOW OFTEN -----------------------------------------------------------------------------------
{
  clearShouts();
  const head = new THREE.Vector3(0, 0, 1);
  let said = 0;
  const TRIES = 100_000;
  for (let i = 0; i < TRIES; i++) if (maybeShout(head)) said++;
  const rate = said / TRIES;
  // Geoff asked for 1 in 50. Over a hundred thousand rolls the observed rate should sit very close.
  ok(Math.abs(rate - SHOUT_CHANCE) < SHOUT_CHANCE * 0.12,
     'about one shot in fifty is accompanied by a shout',
     `1 in ${(1 / rate).toFixed(1)}`);
}

// --- HOW LONG, AND THE FADE ----------------------------------------------------------------------
{
  clearShouts();
  const head = new THREE.Vector3(0, 0, 1);
  // Force one into existence regardless of the odds.
  while (!getShouts().some((s) => s.live)) maybeShout(head);
  const s = getShouts().find((x) => x.live)!;

  ok(s.life >= 1 && s.life <= 3, 'it lasts between one and three seconds', `${s.life.toFixed(2)} s`);
  ok(shoutOpacity(s) === 0, 'it starts fully transparent');

  // Quarter of a second in, it should be at full strength; a hair after birth, it should not be.
  s.age = SHOUT_FADE * 0.5;
  const half = shoutOpacity(s);
  ok(half > 0.3 && half < 0.75, 'half way through the fade-in it is half visible', half.toFixed(2));
  s.age = SHOUT_FADE + 0.01;
  ok(shoutOpacity(s) > 0.99, 'and fully visible once the quarter second is up');

  s.age = s.life - SHOUT_FADE * 0.5;
  const out = shoutOpacity(s);
  ok(out > 0.3 && out < 0.75, 'it fades back out at the same rate', out.toFixed(2));
  s.age = s.life + 0.01;
  ok(shoutOpacity(s) === 0, 'and ends fully transparent');

  // The whole thing must actually retire, or the field fills up with frozen speech.
  clearShouts();
  while (!getShouts().some((x) => x.live)) maybeShout(head);
  for (let i = 0; i < 400; i++) stepShouts(1 / 60);
  ok(getShouts().every((x) => !x.live), 'every bubble eventually goes away');
}

// --- THE POOL --------------------------------------------------------------------------------------
{
  clearShouts();
  const head = new THREE.Vector3(0, 0, 1);
  const before = getShouts().length;
  for (let i = 0; i < 200_000; i++) maybeShout(head);
  ok(getShouts().length === before, 'the bubble pool never grows', `${getShouts().length}`);
  // Every live bubble must point at a real line, or a bubble renders blank.
  ok(getShouts().every((s) => !s.live || (s.line >= 0 && s.line < SHOUTS.length)),
     'every bubble names a line that exists');
}

console.log(`\n${failures === 0 ? 'SHOUT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
