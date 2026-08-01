/**
 * probe-arena-overlap — measure, do not assert. Why can Kaiju still walk through each other?
 *
 * check-player-collision passes with a two-Kaiju arena and a player walking in a straight line.
 * Geoff still reports "the colliders don't work at all". So this runs the REAL configuration — four
 * agents, the real spread, the real behaviour trees — and prints the actual worst overlap for every
 * pair, rather than asserting a threshold that has already proved to be measuring the wrong thing.
 *
 * Run: node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/probe-arena-overlap.ts
 */

import * as THREE from 'three';
import { initArena, stepArena, getAgents, ARENA_HEIGHT } from '../src/components/siege/globe/kaijuArena';
import { body as playerBody, stepBodyOf, reTangentOf, turnTangentOf } from '../src/components/siege/globe/kaijuBody';
import { torsoCapsule, capsuleOverlap, torsoRadiusFrac } from '../src/components/siege/globe/kaijuColliders';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

const DT = 1 / 60;
const capA = torsoCapsule(new THREE.Vector3(0, 0, 1), 1, ARENA_HEIGHT);
const capB = torsoCapsule(new THREE.Vector3(0, 0, 1), 1, ARENA_HEIGHT);
const axis = new THREE.Vector3();

console.log('\n== Real arena: how close do Kaiju actually get? ==\n');
console.log(`  collider radius ${torsoRadiusFrac} x height = `
  + `${(torsoRadiusFrac * ARENA_HEIGHT * METRES_PER_UNIT).toFixed(0)} m`);
console.log(`  so two of them should never be closer than `
  + `${(torsoRadiusFrac * 2 * ARENA_HEIGHT * METRES_PER_UNIT).toFixed(0)} m centre to centre\n`);

initArena(17);
const agents = getAgents();

/** Worst overlap seen for each unordered pair, in metres. */
const worst = new Map<string, number>();
let worstAny = 0;
let worstAtStep = 0;

// Drive the player the way a person does: hold forward, and swing the aim about with the mouse.
let heading = playerBody.forward.clone();

for (let step = 0; step < 90 * 60; step++) {
  stepArena(DT, true);

  // The walk controller's turn: the camera heading swings, and the body chases it.
  reTangentOf(playerBody, heading);
  turnTangentOf(playerBody, heading, Math.sin(step / 90) * 0.03);
  stepBodyOf(playerBody, DT, 1, 0, false, true, ARENA_HEIGHT, heading);

  for (let i = 0; i < agents.length; i++) {
    if (!agents[i].alive) continue;
    torsoCapsule(agents[i].body.dir, agents[i].body.radius, ARENA_HEIGHT, capA);
    for (let j = i + 1; j < agents.length; j++) {
      if (!agents[j].alive) continue;
      torsoCapsule(agents[j].body.dir, agents[j].body.radius, ARENA_HEIGHT, capB);
      const overlapM = capsuleOverlap(capA, capB, axis) * METRES_PER_UNIT;
      if (overlapM <= 0) continue;
      const key = `${agents[i].name}${agents[i].isPlayer ? ' (you)' : ''} / ${agents[j].name}`;
      if (overlapM > (worst.get(key) ?? 0)) worst.set(key, overlapM);
      if (overlapM > worstAny) { worstAny = overlapM; worstAtStep = step; }
    }
  }
}

if (worst.size === 0) {
  console.log('  No pair ever overlapped at all.\n');
} else {
  console.log('  Worst overlap per pair, in metres of interpenetration:');
  for (const [pair, m] of [...worst.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = (m / (ARENA_HEIGHT * METRES_PER_UNIT)) * 100;
    console.log(`    ${m.toFixed(1).padStart(6)} m  (${pct.toFixed(0)}% of a body height)   ${pair}`);
  }
  console.log(`\n  Worst of all: ${worstAny.toFixed(1)} m at step ${worstAtStep} `
    + `(${(worstAtStep / 60).toFixed(1)}s in)\n`);
}

console.log(`  Survivors after 90s: ${agents.filter(a => a.alive).length} of ${agents.length}`);
console.log(`  Swing timers seen: ${agents.map(a => `${a.name}=${a.swingTimer.toFixed(2)}`).join(' ')}\n`);
