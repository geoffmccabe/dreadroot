/**
 * check-paratroopers — the drop is quick, it is real, and it ends on something solid.
 *
 * The descent maths runs on its own numbers, so it can be checked without a browser: the two phases,
 * the opening height, where they have to appear to arrive over the fight, and — against the REAL
 * Dubai bake — that a man aimed at a tower ends up on its roof or at its foot and never inside it.
 *
 * Run: npm run check:paratroopers
 */

import fs from 'node:fs';
import * as THREE from 'three';
import {
  DROP_ALTITUDE_M, TERMINAL_MS, FREEFALL_DRIVE_MS, CANOPY_MS, CANOPY_DRIVE_MS,
  OPEN_CLEARANCE_M, PARA_COUNT, DROP_START_S, DROP_WINDOW_S, CHUTE_COLOURS,
  freefallSpeed, freefallSeconds, openAltitude, driftMetres, dropSeconds, dropSchedule,
} from '../src/components/siege/globe/kaijuParatroopers';
import { parseCity, adoptCity, cityFrame, type City } from '../src/components/siege/globe/cityData';
import { cityGroundMetres } from '../src/components/siege/globe/cityGround';
import { ensureCityColliders, buildingAt } from '../src/components/siege/globe/cityColliders';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== Fifty men over Dubai ==\n');

// --- 1. THE FALL IS REAL ---------------------------------------------------------------------
{
  // Terminal velocity is approached, never exceeded, and reached in about the time it really takes.
  ok(freefallSpeed(0) < 0.1, 'he leaves the aircraft at rest');
  ok(freefallSpeed(3) > 25 && freefallSpeed(3) < 32, 'and is doing about 29 m/s after three seconds',
     `${freefallSpeed(3).toFixed(1)} m/s`);
  ok(freefallSpeed(60) > TERMINAL_MS * 0.999 && freefallSpeed(60) <= TERMINAL_MS,
     'terminal velocity is approached and never passed', `${freefallSpeed(60).toFixed(2)} m/s`);
  // The classic figure: about 12 seconds and 450 m to reach terminal.
  const t = freefallSeconds(450);
  ok(t > 9 && t < 14, 'the first 450 m take about twelve seconds, as they do', `${t.toFixed(1)} s`);
}

// --- 2. AND IT IS QUICK ------------------------------------------------------------------------
// The whole reason for splitting the drop. A canopy open the whole way is nearly six minutes.
{
  const total = dropSeconds();
  const free = freefallSeconds(DROP_ALTITUDE_M - OPEN_CLEARANCE_M);
  const canopy = OPEN_CLEARANCE_M / CANOPY_MS;
  console.log(`  freefall ${free.toFixed(1)} s + canopy ${canopy.toFixed(1)} s = ${total.toFixed(1)} s`
    + `   (canopy the whole way would be ${(DROP_ALTITUDE_M / CANOPY_MS / 60).toFixed(1)} min)`);
  ok(total > 40 && total < 90, 'the drop lands inside a minute and a half', `${total.toFixed(0)} s`);
  ok(free > canopy, 'and most of it is the fall, not the float');
}

// --- 3. THE CANOPY OPENS OVER WHATEVER IS BELOW -------------------------------------------------
{
  ok(openAltitude(0) === OPEN_CLEARANCE_M, 'over the street it opens at the clearance height',
     `${openAltitude(0)} m`);
  ok(openAltitude(366) === 366 + OPEN_CLEARANCE_M,
     'over a 366 m tower it opens 120 m above the ROOF, not the ground', `${openAltitude(366)} m`);
  ok(openAltitude(300) === 300 + OPEN_CLEARANCE_M, 'and clears a 300 m Kaiju the same way');
  // Whatever he is over, the canopy phase is the same short hop — which is what keeps a drop onto a
  // skyscraper from taking four times as long as one into the road.
  const overStreet = OPEN_CLEARANCE_M / CANOPY_MS;
  const overTower = (openAltitude(366) - 366) / CANOPY_MS;
  ok(Math.abs(overStreet - overTower) < 0.01,
     'so time under canopy is the same wherever he lands', `${overStreet.toFixed(1)} s both`);
}

// --- 4. THEY ARRIVE OVER THE FIGHT ---------------------------------------------------------------
// The spawn offset is derived from the two phases. If it drifts from what the descent actually
// covers, fifty men land in the desert.
{
  const drift = driftMetres();
  const free = freefallSeconds(DROP_ALTITUDE_M - OPEN_CLEARANCE_M);
  const covered = free * FREEFALL_DRIVE_MS + (OPEN_CLEARANCE_M / CANOPY_MS) * CANOPY_DRIVE_MS;
  ok(Math.abs(drift - covered) < 1, 'the drop point is exactly the ground the descent covers',
     `${drift.toFixed(0)} m`);
  ok(drift > 200 && drift < 2000, 'and that is a sensible run-in', `${drift.toFixed(0)} m`);
}

// --- 5. THE STICK ---------------------------------------------------------------------------------
{
  const times = dropSchedule(PARA_COUNT);
  ok(times.length === PARA_COUNT, 'fifty men jump', `${times.length}`);
  ok(Math.min(...times) >= DROP_START_S, 'nobody goes before thirty seconds',
     `first at ${Math.min(...times).toFixed(1)} s`);
  ok(Math.max(...times) <= DROP_START_S + DROP_WINDOW_S + 1,
     'and the stick is clear within fifty', `last at ${Math.max(...times).toFixed(1)} s`);
  const sorted = [...times].sort((a, b) => a - b);
  let biggestGap = 0;
  for (let i = 1; i < sorted.length; i++) biggestGap = Math.max(biggestGap, sorted[i] - sorted[i - 1]);
  ok(biggestGap < 4, 'they come out steadily rather than in clumps',
     `biggest gap ${biggestGap.toFixed(1)} s`);
  ok(CHUTE_COLOURS.length === 4, 'four canopy colours, for the four on the flag');
}

// --- 6. AGAINST THE REAL CITY ---------------------------------------------------------------------
// A man dropped straight down onto Dubai must end up on a roof or in the street, never inside a
// building. The descent's own rules, run against the real bake.
{
  const buf = fs.readFileSync('public/siege/city/dubai.bin');
  const { lat, lon, buildings } = parseCity(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const city: City = { lat, lon, buildings, ...cityFrame(lat, lon, cityGroundMetres('Dubai')) };
  adoptCity(city);
  ok(ensureCityColliders(), 'the city is there to land on');

  const DT = 1 / 60;

  /**
   * Run one man's descent to its end. Returns what he landed on and whether he ever hit a wall.
   *
   * The descent's own rules, reproduced: freefall to the opening height, canopy after it, drive
   * toward the aim point, and stop driving the moment a footprint whose roof is ABOVE him gets in
   * the way.
   */
  function drop(startX: number, startZ: number, aimX: number, aimZ: number, alt0: number) {
    let x = startX, z = startZ, alt = alt0, v = 0, pinned = false;
    for (let step = 0; step < 60 * 400; step++) {
      const box = buildingAt(x, z);
      const below = box ? box.h : 0;
      const canopy = alt <= openAltitude(below);
      v = canopy ? CANOPY_MS : Math.min(TERMINAL_MS, v + 9.81 * DT);
      const drive = pinned ? 0 : (canopy ? CANOPY_DRIVE_MS : FREEFALL_DRIVE_MS);
      if (drive > 0) {
        const dx = aimX - x, dz = aimZ - z;
        const len = Math.hypot(dx, dz);
        if (len > 0.5) {
          const nx = x + (dx / len) * drive * DT;
          const nz = z + (dz / len) * drive * DT;
          const hit = buildingAt(nx, nz);
          if (hit && hit.h > alt && hit !== box) pinned = true;
          else { x = nx; z = nz; }
        }
      }
      alt -= v * DT;
      const under = buildingAt(x, z);
      if (under && alt <= under.h) return { on: 'roof' as const, pinned, x, z, h: under.h };
      if (alt <= 0) return { on: 'ground' as const, pinned, x, z, h: 0 };
    }
    return { on: 'never' as const, pinned, x, z, h: 0 };
  }

  // A — AIMED AT A TOWER. The freefall drive carries him over the parapet before the canopy opens,
  // so he should come down on the roof.
  {
    const towers = buildings.filter((b) => b.h > 60 && b.w > 25 && b.d > 25).slice(0, 300);
    let roof = 0, other = 0;
    for (const t of towers) {
      const r = drop(t.x - 200, t.z, t.x, t.z, DROP_ALTITUDE_M);
      if (r.on === 'roof') roof++; else other++;
    }
    ok(roof > towers.length * 0.8, 'aimed at a tower, he lands on its roof',
       `${roof} of ${towers.length}`);
    ok(other < towers.length * 0.2, 'and hardly any miss it', `${other} did not`);
  }

  // B — AIMED AT OPEN GROUND. He must reach the street, not be stopped in mid air.
  {
    // Find genuinely empty spots by sampling and rejecting anything with a footprint on it.
    const open: [number, number][] = [];
    for (let i = 0; open.length < 60 && i < 4000; i++) {
      const a = i * 2.399963;
      const r = 40 * Math.sqrt(i);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!buildingAt(x, z) && !buildingAt(x + 30, z) && !buildingAt(x - 30, z)) open.push([x, z]);
    }
    ok(open.length > 20, 'the city has open ground to land on', `${open.length} spots`);
    let street = 0;
    for (const [x, z] of open) {
      const r = drop(x - 150, z, x, z, DROP_ALTITUDE_M);
      if (r.on === 'ground') street++;
    }
    ok(street > open.length * 0.5, 'aimed at open ground, he lands in the street',
       `${street} of ${open.length}`);
  }

  // C — A LOW OPENING BESIDE A TALL TOWER. This is the wall case: his canopy is already out at 120 m
  // over the road, and the drive then takes him into a face two hundred metres tall.
  {
    const tall = buildings.filter((b) => b.h > 150 && b.w > 30 && b.d > 30).slice(0, 200);
    ok(tall.length > 10, 'the city has faces tall enough to be flown into', `${tall.length}`);
    let slid = 0, insideAtRest = 0, landed = 0;
    for (const t of tall) {
      const reach = Math.max(t.hw ?? t.w * 0.5, t.w * 0.5) + 60;
      const r = drop(t.x - reach, t.z, t.x, t.z, 110);
      if (r.on !== 'never') landed++;
      if (r.pinned) slid++;
      // Wherever he stopped, he must be on a roof or on open ground — never in a wall.
      const under = buildingAt(r.x, r.z);
      if (under && r.on === 'ground') insideAtRest++;
    }
    ok(slid > tall.length * 0.5, 'flying into a face pins him and he slides down it',
       `${slid} of ${tall.length}`);
    ok(landed === tall.length, 'and every one of them reaches the bottom', `${landed}`);
    ok(insideAtRest === 0, 'with nobody left standing inside a building', `${insideAtRest}`);
  }
}

console.log(`\n${failures === 0 ? 'PARATROOPER CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
