/**
 * check-kaiju-speed — no Kaiju may EVER move faster than its own legs could carry it.
 *
 * Geoff, after this had gone wrong four separate ways: "evaluate what you're doing wrong that would
 * allow them to slide around in circles at normal speed as if they were smaller size, and suggest
 * fixes so they stop skating, circling, sliding, or moving so fast, EVER."
 *
 * The word EVER is why this file exists. Each previous cause was a DIFFERENT term quietly adding
 * motion — the behaviour tree choosing to run, knockback, a separation push applied forty-five
 * times, building steering — and fixing them one at a time failed every time, because the next new
 * term restarted the same bug. So this does not test any cause. It measures the RESULT: how far each
 * body actually travelled, over a long fight, whatever moved it.
 *
 * A term added next month that flings a Kaiju will fail here without anyone having to think of it.
 *
 * Run: npm run check:kaiju-speed
 */

import * as THREE from 'three';
import {
  initArenaWith, stepArena, getAgents, ARENA_HEIGHT, speedClampDiag,
} from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import { walkSpeed, runSpeed } from '../src/components/siege/globe/kaijuBody';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const DT = 1 / 60;
const WALK = walkSpeed(ARENA_HEIGHT) * METRES_PER_UNIT;
const RUN = runSpeed(ARENA_HEIGHT) * METRES_PER_UNIT;

console.log('\n== A 300 m creature moves like a 300 m creature ==\n');
console.log(`  the rules: walk ${WALK.toFixed(1)} m/s, run ${RUN.toFixed(1)} m/s, turn about 31 deg/s\n`);

initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
const agents = getAgents();
const prevDir = agents.map((a) => a.body.dir.clone());
const prevFwd = agents.map((a) => a.body.forward.clone());
const stat = agents.map(() => ({ max: 0, sum: 0, n: 0, turnMax: 0 }));

for (let f = 0; f < 60 * 60; f++) {          // a full minute of fighting
  stepArena(DT, false);
  agents.forEach((a, i) => {
    // TRUE ground speed — how far the body really went, not what any one system asked for.
    const moved = prevDir[i].angleTo(a.body.dir) * a.body.radius;
    const ms = (moved / DT) * METRES_PER_UNIT;
    stat[i].max = Math.max(stat[i].max, ms);
    stat[i].sum += ms;
    stat[i].n++;
    const turn = (prevFwd[i].angleTo(a.body.forward) / DT) * 180 / Math.PI;
    stat[i].turnMax = Math.max(stat[i].turnMax, turn);
    prevDir[i].copy(a.body.dir);
    prevFwd[i].copy(a.body.forward);
  });
}

console.log('  agent            mean      peak    turn peak');
agents.forEach((a, i) => {
  const s = stat[i];
  console.log(`  ${a.name.padEnd(14)} ${(s.sum / s.n).toFixed(1).padStart(5)} m/s  `
    + `${s.max.toFixed(1).padStart(6)} m/s  ${s.turnMax.toFixed(0).padStart(6)} deg/s`);
});
console.log('');

// THE ONE THAT MATTERS. Not "close to" walking pace — never above it, in any single frame of a
// full minute, for any creature, from any cause.
const CEILING = WALK * 1.25;          // the clamp's own headroom plus a frame of slack
for (let i = 0; i < agents.length; i++) {
  ok(stat[i].max <= CEILING,
     `${agents[i].name} never exceeds walking pace`,
     `peak ${stat[i].max.toFixed(1)} m/s vs ceiling ${CEILING.toFixed(1)}`);
}

// ...and nothing may sit AT the ceiling either, which would mean the clamp is the only thing
// holding it back rather than the locomotion behaving.
const worstMean = Math.max(...stat.map((s) => s.sum / s.n));
ok(worstMean < WALK, 'and none of them averages a full walking pace — they stop and fight too',
   `busiest averages ${worstMean.toFixed(1)} m/s`);

// A 300 m creature does not pirouette.
for (let i = 0; i < agents.length; i++) {
  // The rule is turnRate(300 m) = about 31 deg/s. The ceiling allows 10% over; a frame of slack on
  // top of that puts the honest limit near 40. Anything above that means a second system is turning
  // the creature on the same frame, which is what made them pirouette at 200.
  ok(stat[i].turnMax < 40,
     `${agents[i].name} turns like something enormous`,
     `peak ${stat[i].turnMax.toFixed(0)} deg/s vs a rule of 31`);
}

// The clamp is a backstop, not the mechanism. If it fires on most frames then something upstream is
// pushing constantly and the ceiling is merely hiding it — which is how this looked "fixed" before.
const frames = 60 * 60 * agents.length;
ok(speedClampDiag.turnClamped < frames * 0.15,
   'and the turn ceiling is a backstop too',
   `it caught ${speedClampDiag.turnClamped} of ${frames} agent-frames`);
ok(speedClampDiag.clamped < frames * 0.05,
   'the ceiling is a backstop, not what is doing the work',
   `it caught ${speedClampDiag.clamped} of ${frames} agent-frames`
   + `${speedClampDiag.worstMetres > 0 ? `, worst ${speedClampDiag.worstMetres.toFixed(0)} m/s` : ''}`);

console.log(`\n${failures === 0 ? 'SPEED CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
