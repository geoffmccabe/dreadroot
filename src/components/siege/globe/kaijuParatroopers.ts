// kaijuParatroopers — fifty men over Dubai: a long fall, then fifty canopies at once.
//
// Geoff: "add 50 soldiers as paratroopers... they should be shooting while they are falling, with
// the same chance to shoot as other soldiers, and they should be talking with the same chance to
// talk as the others too." Then: "Have them fall the first part free falling and then pop their
// chutes closer to the ground, building tops, or kaijus. And let's have them start a little lower,
// at 2km."
//
// THEY ARE THE SAME SOLDIERS. Not a parallel system: a paratrooper is an ordinary member of the
// crowd with an altitude, and everything that makes him a soldier — picking a Kaiju, firing at it,
// shouting, the rifle, the animations — is the code that was already there and is left alone. Only
// how he moves and how high he stands branch. A second kind of soldier would mean a second
// implementation of "fires every 1-10 seconds", which is how two numbers that must agree stop
// agreeing.
//
// AND NOW EVERY NUMBER IS REAL, which the first attempt could not manage.
//
// A canopy open for the whole descent is the problem: a T-11 comes down at 5.8 m/s, so two thousand
// metres under silk is nearly six minutes. Freefall is the opposite — terminal velocity is about
// 55 m/s, so the same two thousand metres takes well under a minute. Splitting the drop the way a
// real HALO jump does gets both: a long fall at a real speed, canopies at a real speed, and about a
// MINUTE end to end. Nothing here is fudged any more.
//
//     2000 m, freefall to terminal                    ~38 s
//     canopy at 120 m above whatever is beneath him   ~21 s
//     ------------------------------------------------------
//                                                     ~59 s

import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { fxRand as rand } from './kaijuRandom';

/** Where they leave the aircraft, in metres above the city's ground plane. */
export const DROP_ALTITUDE_M = 2000;

/** Gravity. The same 9.81 the bullets use, and for the same reason: it is not a tuning knob. */
const G = 9.81;
/**
 * Freefall terminal velocity, belly to earth. 53-56 m/s for a person in a jump suit.
 *
 * This is what makes two kilometres take thirty-eight seconds instead of six minutes, and it is why
 * the drop can be both quick and honest.
 */
export const TERMINAL_MS = 55;
/**
 * How fast a tracking skydiver moves across the ground during freefall.
 *
 * Real, and generous: a good tracking position gets 15-25 m/s. It is what lets them cover the
 * ground between the drop point and the fight before the canopies ever open.
 */
export const FREEFALL_DRIVE_MS = 15;

/** Rate of descent under canopy. The US Army T-11's figure for an average jumper. */
export const CANOPY_MS = 5.8;
/** Forward drive of a steerable canopy — a glide ratio of about 0.7, right for a round. */
export const CANOPY_DRIVE_MS = 4.0;

/**
 * How high above whatever is underneath him the canopy opens.
 *
 * Geoff: "pop their chutes closer to the ground, building tops, or kaijus." So the opening height
 * is not a fixed altitude — it is measured from the ROOF he is over, or the Kaiju he is over, or
 * the street if neither. A man dropping onto a 366 m tower opens at 486 m and one dropping into the
 * road opens at 120, and both get the same twenty seconds under canopy.
 *
 * 120 m is also close to a real reserve's hard deck, which is a pleasing accident rather than a
 * design goal.
 */
export const OPEN_CLEARANCE_M = 120;

/**
 * Freefall speed after falling for `seconds`, with air resistance.
 *
 * The closed form for quadratic drag: v = vt * tanh(g t / vt). Used for the spawn estimate below;
 * the descent itself integrates per frame, which is the same curve arrived at the other way round.
 */
export const freefallSpeed = (seconds: number): number =>
  TERMINAL_MS * Math.tanh((G * seconds) / TERMINAL_MS);

/** ...and how far he has fallen by then: y = (vt^2/g) * ln(cosh(g t / vt)). */
export const freefallDistance = (seconds: number): number =>
  ((TERMINAL_MS * TERMINAL_MS) / G) * Math.log(Math.cosh((G * seconds) / TERMINAL_MS));

/** Seconds of freefall to cover a given drop, by inverting the above. */
export function freefallSeconds(metres: number): number {
  const k = G / TERMINAL_MS;
  // arccosh(x) = ln(x + sqrt(x^2 - 1)); x is enormous here, so the log form is the stable one.
  const x = Math.exp((metres * G) / (TERMINAL_MS * TERMINAL_MS));
  return Math.log(x + Math.sqrt(Math.max(0, x * x - 1))) / k;
}

/** How many. */
export const PARA_COUNT = 50;
/** Seconds after the battle begins before the first man leaves. */
export const DROP_START_S = 30;
/** ...and how long the stick takes to clear, one man a second. */
export const DROP_WINDOW_S = 50;

/**
 * How far out they should appear, so the drop brings them OVER the fight rather than short of it.
 *
 * Derived from the two phases rather than chosen: however long each lasts, that long times its own
 * forward speed. Change the altitude, the terminal velocity or either drive and the drop zone moves
 * itself. At 2 km that is a little over six hundred metres of run.
 */
export function driftMetres(): number {
  const free = freefallSeconds(DROP_ALTITUDE_M - OPEN_CLEARANCE_M);
  const canopy = OPEN_CLEARANCE_M / CANOPY_MS;
  return free * FREEFALL_DRIVE_MS + canopy * CANOPY_DRIVE_MS;
}

/** How long the whole drop takes over open ground, for the readout and for the checks. */
export function dropSeconds(): number {
  return freefallSeconds(DROP_ALTITUDE_M - OPEN_CLEARANCE_M) + OPEN_CLEARANCE_M / CANOPY_MS;
}

/**
 * The altitude this man's canopy should open at, given what is underneath him.
 *
 * `belowM` is the height of the roof or the Kaiju he is over, or 0 for the street.
 */
export const openAltitude = (belowM: number): number => Math.max(0, belowM) + OPEN_CLEARANCE_M;

/** The UAE flag: red, green, white, black. Linear values, since that is what three.js wants. */
export const CHUTE_COLOURS: [number, number, number][] = [
  [0.44, 0.02, 0.05],   // red
  [0.00, 0.16, 0.06],   // green
  [0.85, 0.85, 0.83],   // white
  [0.02, 0.02, 0.02],   // black
];

/** Canopy radius in metres — 8 m across, as asked. */
export const CHUTE_RADIUS_M = 4;
/** How much of the circle is drawn, centred directly overhead. */
export const CHUTE_ARC_RAD = Math.PI / 4;
/** Length of the canopy along its own axis. */
export const CHUTE_LENGTH_M = 8;

/**
 * One canopy in the air, as the renderer needs it. Rebuilt each frame by the crowd.
 *
 * A flat list handed over rather than the renderer reaching into the crowd's own state: the same
 * split the gunfire keeps, and it means the canopies can be drawn as one instanced mesh without the
 * drawing code knowing anything about soldiers.
 */
export interface Canopy {
  pos: THREE.Vector3;
  /** Local up at the jumper — the canopy hangs along it. */
  up: THREE.Vector3;
  /** Direction of drive, so the canopy leans into it the way one under drive does. */
  fwd: THREE.Vector3;
  colour: number;
}

const canopies: Canopy[] = [];
for (let i = 0; i < PARA_COUNT; i++) {
  canopies.push({
    pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    fwd: new THREE.Vector3(0, 0, 1), colour: 0,
  });
}
let live = 0;

export const paraDiag = { pending: 0, freefall: 0, canopy: 0, landed: 0 };

/** Start a frame's worth of canopies. */
export function beginCanopies(): void { live = 0; }

/** Add one. Ignored past the ceiling, which cannot be hit since the pool is the drop size. */
export function addCanopy(
  pos: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, colour: number,
): void {
  if (live >= canopies.length) return;
  const c = canopies[live++];
  c.pos.copy(pos);
  c.up.copy(up);
  c.fwd.copy(fwd);
  c.colour = colour;
}

export function getCanopies(): Canopy[] { return canopies; }
export function canopyCount(): number { return live; }

/**
 * When each man in the stick jumps, in seconds from the start of the battle.
 *
 * One a second across the window, then jittered inside his own slot and shuffled — so the sky fills
 * steadily rather than in a clump, and no two drops are exactly a second apart.
 */
export function dropSchedule(count = PARA_COUNT): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const slot = (i / count) * DROP_WINDOW_S;
    out.push(DROP_START_S + slot + rand() * (DROP_WINDOW_S / count));
  }
  return out;
}

/** Altitude in world units above the city ground, for placing a falling man. */
export const altToUnits = (metres: number): number => metres / METRES_PER_UNIT;
