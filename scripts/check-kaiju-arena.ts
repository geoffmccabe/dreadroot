/**
 * check-kaiju-arena — run the Everest fight headless and assert it is actually a fight.
 *
 * This exists because of how this project has gone so far: things that "should" work have
 * repeatedly turned out to be doing nothing on screen, and there was no way to tell without
 * Geoff loading the game. A three-way Kaiju battle is entirely simulable without a renderer, so
 * it gets simulated here.
 *
 * What it proves, without a browser:
 *   - every behaviour tree parses and steps without throwing (a State returned from a condition
 *     throws in Mistreevous and silently freezes the agent)
 *   - the utility layer actually changes its mind as the fight develops
 *   - projectiles connect, damage lands, and somebody eventually dies
 *   - low health flips an agent to flee, which is Geoff's headline example rule
 *
 * Terrain tiles are not resident in node, so the bodies walk on the sea-level sphere. That does
 * not affect any of the above: it only removes the cover query, which is asserted separately.
 *
 * Run: npm run check:kaiju-arena
 */

import {
  initArena, initArenaWith, stepArena, getAgents, getEvents, arenaReport, ARENA_HEIGHT,
} from '../src/components/siege/globe/kaijuArena';
import { getProjectiles } from '../src/components/siege/globe/kaijuWeapons';
import { scoreActions, chooseAction } from '../src/components/siege/globe/kaijuBrain';
import * as THREE from 'three';
import {
  createKaijuBody, placeBodyOnSurface, reTangentOf, stepBodyOf,
} from '../src/components/siege/globe/kaijuBody';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`); failures++; }
}

console.log('\n== Kaiju arena: headless three-way fight ==\n');

// Steering, first, because everything above it is meaningless if a body cannot turn toward a
// heading. This regression exists because `stepBodyOf` used to turn the body AWAY from its
// steering direction: the sign of the turn was inverted. It never showed up in a straight-line
// test, since a body already facing its target never turns at all. Three Kaiju told to charge
// each other and slowly drifting apart is what exposed it.
{
  let bad = 0;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.6, 0.8], [-0.6, -0.8]]) {
    const b = createKaijuBody();
    placeBodyOnSurface(b, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
    const want = new THREE.Vector3(dx, dy, 0).normalize();
    for (let i = 0; i < 40; i++) {
      const w = want.clone();
      reTangentOf(b, w);
      stepBodyOf(b, 1 / 30, 1, 0, false, false, 3, w);
    }
    if (b.forward.dot(want) <= 0.9) bad++;
  }
  ok(bad === 0, 'a steered body turns TOWARD its heading from every direction', `${bad} failed`);
}

initArena(17);
const agents = getAgents();
// Geoff wants THREE opponents, so four Kaiju in total, and each must be a visibly different
// creature — four identical golems is not a battle worth watching.
ok(agents.length === 4, 'you plus three opponents', `${agents.length} agents`);
ok(new Set(agents.map((a) => a.monsterType)).size === 4, 'four DIFFERENT monster models',
   agents.map((a) => a.monsterType).join(','));
ok(new Set(agents.map((a) => a.weapon)).size >= 3, 'at least three different weapons');
ok(agents.filter((a) => a.isPlayer).length === 1, 'exactly one player agent');
ok(agents.find((a) => a.isPlayer)?.weapon === 'flame', "player's Kaiju has the flamethrower");
ok(agents.every((a) => a.health === a.maxHealth), 'all start at full health');

// Everyone starts within sight of everyone else.
const startDist = agents.map((a) => a.perception?.targetDistBodies ?? 999);

// Run 90 seconds at 30 Hz with the player under AI control too, so all three fight.
const DT = 1 / 30;
const actionsSeen = new Set<string>();
let maxProjectiles = 0;
let steps = 0;
for (let i = 0; i < 90 * 30; i++) {
  stepArena(DT, false);
  steps++;
  for (const a of agents) if (a.action) actionsSeen.add(a.action);
  maxProjectiles = Math.max(maxProjectiles, getProjectiles().length);
  if (agents.filter((a) => a.alive).length <= 1) break;
}
console.log(`\n  simulated ${(steps * DT).toFixed(1)}s over ${steps} steps\n`);

ok(agents.every((a) => a.lastTreeState !== 'ERROR'), 'no behaviour tree threw',
   agents.map((a) => `${a.name}=${a.lastTreeState}`).join(' '));
ok(maxProjectiles > 0, 'projectiles were fired', `peak ${maxProjectiles}`);
ok(agents.some((a) => a.damageDealt > 0), 'damage was dealt',
   agents.map((a) => `${a.name} dealt ${Math.round(a.damageDealt)}`).join(', '));
// Most of them must connect. NOT all of them: in a four-way brawl the fragile one genuinely can
// be focused down before it lands anything, and asserting otherwise would be asserting that glass
// cannons cannot lose quickly, which is wrong. The real worry — "is a weapon simply incapable of
// hitting?" — is tested directly below instead, per weapon.
ok(agents.filter((a) => a.damageDealt > 0).length >= 3, 'at least three of the four connected',
   agents.map((a) => `${a.name}=${Math.round(a.damageDealt)}`).join(', '));
ok(actionsSeen.size >= 2, 'the utility layer changed its mind at least once',
   [...actionsSeen].join(', '));
ok(agents.some((a) => !a.alive), 'somebody died within 90s',
   agents.map((a) => `${a.name}=${Math.round(a.health)}`).join(', '));

// Agents must move: a frozen Kaiju is the exact failure mode we keep hitting.
ok(agents.some((a, i) => Math.abs((a.perception?.targetDistBodies ?? 0) - startDist[i]) > 0.5),
   'agents moved relative to each other');

// NOTHING MAY MOVE A KAIJU FOREVER.
//
// Knockback was being passed through reTangentOf, which NORMALISES — resetting it to length 1.0
// every tick, so it never decayed and shoved the victim at three times its cap for the rest of the
// fight. That was one of the two causes of "my Kaiju is sliding for no reason". Both halves are
// asserted: the cap holds, and it bleeds away to nothing when nothing is hitting you.
{
  initArena(17);
  const four = getAgents();
  let peakKnock = 0;
  for (let i = 0; i < 90 * 30; i++) {
    stepArena(1 / 30, false);
    for (const a of four) peakKnock = Math.max(peakKnock, a.knock.length());
    if (four.filter((a) => a.alive).length <= 1) break;
  }
  ok(peakKnock <= 0.36, 'knockback never exceeds its cap', `peak ${peakKnock.toFixed(3)} vs 0.35`);

  // Decay has to be measured with NOTHING shooting. Leaving the other three alive meant the
  // victim was being hit throughout the window, which measures the cap again rather than decay.
  initArena(17);
  const all = getAgents();
  for (const a of all) if (!a.isPlayer) a.alive = false;
  const victim = all[0];
  victim.knock.set(0.3, 0, 0);
  victim.knock.addScaledVector(victim.body.dir, -victim.knock.dot(victim.body.dir));
  const before = victim.knock.length();
  for (let i = 0; i < 90; i++) stepArena(1 / 30, true);
  ok(victim.knock.length() < 0.001, 'knockback decays to nothing when nothing is hitting it',
     `${before.toFixed(3)} -> ${victim.knock.length().toFixed(5)} over 3s`);
}

// THEY MUST NOT STAND INSIDE EACH OTHER.
//
// Geoff: "The Red demon is just standing inside me walking in circles." Before body separation
// existed, two 300 m creatures could occupy exactly the same space and circle there indefinitely.
// This runs a fight and records the CLOSEST any two ever get, measured centre to centre.
{
  initArena(17);
  const four = getAgents();
  let closest = Infinity;
  let overlapTicks = 0;
  for (let i = 0; i < 60 * 30; i++) {
    stepArena(1 / 30, false);
    for (let x = 0; x < four.length; x++) {
      for (let y = x + 1; y < four.length; y++) {
        if (!four[x].alive || !four[y].alive) continue;
        const px = four[x].body.dir.clone().multiplyScalar(four[x].body.radius);
        const py = four[y].body.dir.clone().multiplyScalar(four[y].body.radius);
        const d = px.distanceTo(py);
        if (d < closest) closest = d;
        // Torso radius is a quarter of body height each, so their combined width is half a
        // height. TOUCHING at exactly that is correct — two bodies in contact is what a brawl
        // looks like. What must never happen is one standing INSIDE the other, so this allows a
        // 10% contact tolerance and fails on anything deeper.
        if (d < ARENA_HEIGHT * 0.5 * 0.90) overlapTicks++;
      }
    }
  }
  console.log(`\n  closest two Kaiju ever came: ${closest.toFixed(2)} units `
    + `(${(closest * 100).toFixed(0)} m; their combined width is ${(ARENA_HEIGHT * 0.5 * 100).toFixed(0)} m)`);
  ok(overlapTicks === 0, 'no Kaiju ever stood inside another', `${overlapTicks} ticks interpenetrating`);
  console.log('  (they touch, which is correct — a brawl has contact. What must not happen, and');
  console.log('   now does not, is one occupying the same space as another.)');
}

// THE GRENADE MUST ARC, AND EXPLODE INTO SOMETHING BIG.
//
// A projectile with gravity that never visibly rises is just a slow bullet. This fires one and
// records the height profile of its flight, then counts what the detonation leaves behind.
{
  initArenaWith([
    { name: 'Thrower', tier: 3, monsterType: 15, weapon: 'grenade', obedience: 50, abilities: [],
      stats: { might: 50, armour: 40, vigour: 60, speed: 45, instinct: 60 } },
    { name: 'Target', tier: 3, monsterType: 16, weapon: 'gun', obedience: 50, abilities: [],
      stats: { might: 50, armour: 40, vigour: 60, speed: 45, instinct: 60 } },
  ], 31337, 3);

  let apex = 0;
  let sawGrenade = false;
  let peakDebris = 0;
  for (let i = 0; i < 40 * 30; i++) {
    stepArena(1 / 30, false);
    let debris = 0;
    for (const p of getProjectiles()) {
      if (p.visual === 'grenade') {
        sawGrenade = true;
        apex = Math.max(apex, (p.pos.length() - 63710) * 100);   // metres above sea level
      }
      if (p.visual === 'blast') debris++;
    }
    peakDebris = Math.max(peakDebris, debris);
  }
  console.log(`\n  grenade apex ${apex.toFixed(0)} m (the Kaiju is 300 m tall)`);
  console.log(`  peak explosion debris in flight: ${peakDebris} particles`);
  ok(sawGrenade, 'a grenade was actually thrown');
  ok(apex > 300, 'it arcs ABOVE the thrower rather than flying flat', `${apex.toFixed(0)} m`);
  ok(peakDebris > 200, 'the explosion is hundreds of particles, not a puff', `${peakDebris}`);
}

// FLAME MUST SET THINGS ALIGHT, AND THE BURN MUST STOP.
//
// Damage-over-time is the classic place to leave something burning forever, or to stack a jet of
// 1500 particles into a burn of minutes. Both are asserted against.
{
  const mk = (name: string, weapon: 'flame' | 'gun') => ({
    name, tier: 3, monsterType: 16, weapon, obedience: 50, abilities: [],
    stats: { might: 50, armour: 40, vigour: 60, speed: 45, instinct: 60 },
  });
  initArenaWith([mk('Torch', 'flame'), mk('Victim', 'gun')], 909, 3);
  const two = getAgents();
  let sawBurning = false;
  let maxBurn = 0;
  for (let i = 0; i < 40 * 20; i++) {
    stepArena(1 / 20, false);
    for (const a of two) { if (a.burning > 0) sawBurning = true; maxBurn = Math.max(maxBurn, a.burning); }
    if (two.filter((x) => x.alive).length <= 1) break;
  }
  ok(sawBurning, 'flame sets its target alight');
  ok(maxBurn <= 10.01, 'the burn never stacks beyond its 10 second cap', `peak ${maxBurn.toFixed(1)}s`);

  // And it must burn OUT. Let everything settle with nobody firing.
  initArenaWith([mk('Torch', 'flame'), mk('Victim', 'gun')], 909, 3);
  const pair = getAgents();
  pair[1].burning = 8;
  for (let i = 0; i < 30 * 20; i++) stepArena(1 / 20, false);
  ok(pair[1].burning === 0 || !pair[1].alive, 'the burn expires rather than lasting forever',
     `${pair[1].burning.toFixed(1)}s left`);
}

// EVERY WEAPON MUST BE ABLE TO HIT. A weapon that can never connect looks exactly like a Kaiju
// that is simply losing, which is how the grenade could have gone unnoticed. So each one gets a
// duel of its own against an identical opponent, where it has time to land something.
{
  const solo: Record<string, number> = {};
  for (const w of ['flame', 'gun', 'grenade'] as const) {
    const mk = (name: string, weapon: typeof w) => ({
      name, tier: 3, monsterType: 16, weapon, obedience: 50, abilities: [],
      stats: { might: 50, armour: 40, vigour: 60, speed: 45, instinct: 60 },
    });
    initArenaWith([mk('A', w), mk('B', w)], 4242, 4);
    const two = getAgents();
    for (let i = 0; i < 60 * 20; i++) {
      stepArena(1 / 20, false);
      if (two.filter((x) => x.alive).length <= 1) break;
    }
    solo[w] = Math.max(...two.map((x) => x.hitsLanded));
    ok(solo[w] > 0, `the ${w} can actually hit something`, `${solo[w]} hits in 60s`);
  }
}

// Put the demo fight back, since the checks below read its report.
initArena(17);
for (let i = 0; i < 30 * 30; i++) {
  stepArena(1 / 30, false);
  if (getAgents().filter((a) => a.alive).length <= 1) break;
}

// The headline rule, tested directly on the brain rather than via the fight, so it is
// deterministic: "under 10% health, turn and run".
const dying = {
  selfId: 'x', healthFrac: 0.05, targetId: 'y', targetDistBodies: 3, powerRatio: 1.2,
  powerRatioClosed: 1.2, threatCount: 1, weaponRangeBodies: 2.2, weapon: 'flame' as const,
  coverNearby: false, timeSinceHit: 0.2,
  // A competent, averagely-obedient Kaiju, so these tests read the brain and not a stat quirk.
  instinct: 1, obedience: 0.5, neverFlees: false, fearPressure: 0,
};
const fleeChoice = chooseAction(scoreActions(dying), 'engage');
ok(fleeChoice.action === 'flee', 'at 5% health the brain chooses flee', `chose ${fleeChoice.action}`);

const healthy = { ...dying, healthFrac: 1, powerRatio: 0.8, powerRatioClosed: 0.8 };
const healthyChoice = chooseAction(scoreActions(healthy), null);
ok(healthyChoice.action !== 'flee', 'at full health it does NOT flee', `chose ${healthyChoice.action}`);

// A short-range fighter that is outgunned AT RANGE but wins UP CLOSE must charge. This is the
// exact case that made the flamethrower Kaiju wander away from the fight for 90 seconds.
const outranged = {
  ...dying, healthFrac: 1, targetDistBodies: 10, powerRatio: 2.4, powerRatioClosed: 0.5,
  weaponRangeBodies: 2.2,
};
const charge = chooseAction(scoreActions(outranged), null);
ok(charge.action === 'engage', 'outranged but stronger up close => charges', `chose ${charge.action}`);

// Cover-seeking must be vetoed outright when there is no cover, not merely scored low.
const noCover = { ...dying, healthFrac: 0.5, powerRatio: 1.6, powerRatioClosed: 1.6, coverNearby: false };
const coverScore = scoreActions(noCover).find((s) => s.action === 'takeCover');
ok(coverScore?.score === 0, 'no cover nearby vetoes takeCover entirely', `score ${coverScore?.score}`);
const withCover = { ...noCover, coverNearby: true };
const coverScore2 = scoreActions(withCover).find((s) => s.action === 'takeCover');
ok((coverScore2?.score ?? 0) > 0, 'with cover available takeCover becomes possible',
   `score ${coverScore2?.score}`);

// The report is what Geoff copies to us, so it must actually contain the useful things.
const report = arenaReport();
for (const need of ['KAIJU ARENA REPORT', 'PERCEIVES', 'SCORES', 'EVENTS', 'Flamethrower']) {
  ok(report.includes(need), `report contains "${need}"`);
}
ok(getEvents().length > 1, 'events were logged', `${getEvents().length} events`);

console.log('\n--- last 30 lines of the report, as Geoff would see it ---');
console.log(report.split('\n').slice(-30).join('\n'));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
