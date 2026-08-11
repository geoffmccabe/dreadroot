// cityColliders — the city as solid geometry: soldiers walk round it, bullets stop against it.
//
// Geoff: "make sure the buildings have colliders and the soldiers walk around them (greedy
// pathfinding so they flow around) and that their bullets hit the buildings. The colliders on the
// buildings need to match perfectly to their shapes."
//
// THEY MATCH EXACTLY, and that is luck rather than craft: every building in this city IS a box.
// KaijuCity draws them as one instanced unit cube, scaled and rotated per building, so a rotated box
// collider is not an approximation of the shape — it is the same six planes the renderer uses. There
// is no spire to simplify away and no gap to tune. If the bake ever grows real silhouettes this file
// becomes an approximation and the comment should stop claiming otherwise.
//
// EVERYTHING HERE WORKS IN CITY-LOCAL METRES. Not world units, and deliberately not:
//
//   * The bake is already in metres from the city origin, so no conversion can drift.
//   * Ten kilometres of city expressed in metres is a five-digit number, where float64 has plenty
//     left over. The same points in world coordinates are six million metres from the planet's
//     centre, which is where the soldiers' skeletons fell apart (see skinPrecision.ts).
//   * The ground is flat and level in this frame, so avoidance is two-dimensional and cheap.
//
// A UNIFORM GRID, not a tree. Forty thousand buildings and two hundred soldiers asking "what is near
// me" every frame, plus a hundred bullets asking "what did I just cross". A grid is one multiply and
// a hash per query with no traversal, it never needs rebalancing, and the city never moves.

import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { getCity, type City } from './cityData';

/** One building, precomputed for collision. Metres, and the rotation resolved to a cos/sin pair. */
export interface CityBox {
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Half width and half depth, along the box's OWN axes. */
  hw: number;
  hd: number;
  /** Full height. The base sits at y = 0, matching the renderer's base-origin cube. */
  h: number;
  cos: number;
  sin: number;
}

/**
 * Grid cell size in metres.
 *
 * 128 is a little under Dubai's block spacing, so a query touches one or two cells and a big tower
 * lands in four. Smaller means more cells to walk per query; larger means more boxes tested per
 * cell. Neither is expensive here, and this sits near the flat part of the curve.
 */
const CELL = 128;
/** Half the grid's addressable span, in cells: +-4096 cells is +-524 km, far past any city. */
const HALF = 4096;

const boxes: CityBox[] = [];
const grid = new Map<number, number[]>();
/**
 * Visit stamps, so a building sitting in four cells is tested ONCE per query.
 *
 * Without this a wide tower in the middle of a query's cell span gets its push applied four times
 * and flings the walker across the street.
 */
let seen = new Int32Array(0);
let stamp = 0;
let indexedCity: City | null = null;

const cityOrigin = new THREE.Vector3();
const cityInverse = new THREE.Quaternion();
/**
 * How far the indexed city actually reaches, in metres, plus a margin.
 *
 * Nothing outside this can possibly touch a building, and asking is not free — so a query from the
 * far side of the planet is rejected on one comparison instead of walking the grid.
 */
let cityReachM = 0;

export const cityColliderDiag = { boxes: 0, cells: 0, ready: false, reachKm: 0 };

/**
 * Cell key. Returns -1 for anything outside the addressable span, which must never be looked up.
 *
 * The bare form of this — (cx + HALF) * (HALF * 2) + (cz + HALF) — is only a unique encoding while
 * BOTH coordinates are inside the span. Outside it the pairs alias: a query at cz >= HALF lands on
 * exactly the key of a real cell one step over in x, so a point far from the city could come back
 * holding buildings that are not there. It has never fired, because the only city ever loaded sits
 * at the origin of its own frame and worldToCity now rejects distant points before this is reached —
 * but "it cannot happen" and "it is impossible" are different claims, and this makes it the second.
 */
const cellKey = (cx: number, cz: number): number =>
  (cx < -HALF || cx >= HALF || cz < -HALF || cz >= HALF)
    ? -1
    : (cx + HALF) * (HALF * 2) + (cz + HALF);

/**
 * Build the collider set from the loaded city. Cheap to call every frame; does the work once.
 *
 * Returns false when there is no city, which is the normal state everywhere except Dubai — every
 * caller has to cope with that rather than assume a city exists.
 */
export function ensureCityColliders(): boolean {
  const city = getCity();
  if (!city) return false;
  if (indexedCity === city) return true;

  boxes.length = 0;
  grid.clear();
  cityOrigin.copy(city.position);
  cityInverse.copy(city.quaternion).invert();

  for (const b of city.buildings) {
    // NEGATIVE rot, to match the renderer exactly. KaijuCity sets rotation.y = -b.rot because the
    // bake's angle lives in an (east, south) plane and a +Y rotation carries +X toward -Z. Copying
    // the sign rather than re-deriving it is the only way these two can never disagree.
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    const box: CityBox = { x: b.x, z: b.z, hw: b.w * 0.5, hd: b.d * 0.5, h: b.h, cos: c, sin: s };
    const i = boxes.push(box) - 1;

    // Insert into every cell the footprint's bounding box touches. A rotated rectangle's extent is
    // hw*|cos| + hd*|sin| across, and the mirror of that along the other axis.
    const ex = box.hw * Math.abs(c) + box.hd * Math.abs(s);
    const ez = box.hw * Math.abs(s) + box.hd * Math.abs(c);
    const x0 = Math.floor((box.x - ex) / CELL), x1 = Math.floor((box.x + ex) / CELL);
    const z0 = Math.floor((box.z - ez) / CELL), z1 = Math.floor((box.z + ez) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cellKey(cx, cz);
        if (k < 0) continue;                       // a building outside the addressable span
        const list = grid.get(k);
        if (list) list.push(i); else grid.set(k, [i]);
      }
    }
  }

  // The city's own extent, so anything far outside it can be rejected in one comparison.
  let reach = 0;
  for (const b of boxes) {
    const ex = b.hw * Math.abs(b.cos) + b.hd * Math.abs(b.sin);
    const ez = b.hw * Math.abs(b.sin) + b.hd * Math.abs(b.cos);
    reach = Math.max(reach, Math.hypot(Math.abs(b.x) + ex, Math.abs(b.z) + ez));
  }
  cityReachM = reach + CELL * 2;

  seen = new Int32Array(boxes.length);
  stamp = 0;
  indexedCity = city;
  cityColliderDiag.boxes = boxes.length;
  cityColliderDiag.cells = grid.size;
  cityColliderDiag.ready = true;
  cityColliderDiag.reachKm = cityReachM / 1000;
  console.log(`[city] ${boxes.length.toLocaleString()} colliders in ${grid.size.toLocaleString()} cells`
    + `, reach ${(cityReachM / 1000).toFixed(1)} km`);
  return true;
}

/** Drop the index, so a different city or a reload rebuilds rather than colliding with the old one. */
export function clearCityColliders(): void {
  boxes.length = 0;
  grid.clear();
  indexedCity = null;
  cityColliderDiag.boxes = 0;
  cityColliderDiag.cells = 0;
  cityColliderDiag.ready = false;
}

/** World position to city-local METRES. Null when there is no city to be local to. */
export function worldToCity(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  if (!indexedCity) return null;
  out.copy(world).sub(cityOrigin).applyQuaternion(cityInverse).multiplyScalar(METRES_PER_UNIT);
  // ONLY THE LOCAL CITY, and this is the guard that makes that true.
  //
  // Geoff: "make sure that it's only considering the local buildings and not accidentally
  // considering other cities on the same earth map."
  //
  // There is one city loaded at a time, so there is no second city to confuse it with today. But
  // nothing here said so: this returned a coordinate for ANY point on the planet, including one
  // twelve thousand kilometres away, and handed it to a grid that then had to reason about cells
  // half a million cells out. Rejecting anything past the city's own measured extent makes "local"
  // a property of the code rather than a happy accident of only ever loading one city — which is
  // exactly the assumption that would break the day a second one is added.
  if (out.x * out.x + out.z * out.z > cityReachM * cityReachM) return null;
  return out;
}

/** ...and back. */
export function cityToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(local).multiplyScalar(1 / METRES_PER_UNIT)
    .applyQuaternion(indexedCity!.quaternion).add(cityOrigin);
}

/** Direction from city-local to world. Rotation only — no origin, no scale. */
export function cityDirToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(local).applyQuaternion(indexedCity!.quaternion).normalize();
}
/** The other way: a world-space heading expressed in the city's flat local frame. */
export function worldDirToCity(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  if (!indexedCity) return null;
  return out.copy(world).applyQuaternion(cityInverse).normalize();
}

/** Visit every building whose cell overlaps this circle. May visit one twice; callers must cope. */
function forEachNear(x: number, z: number, radius: number, fn: (b: CityBox, i: number) => void): void {
  const x0 = Math.floor((x - radius) / CELL), x1 = Math.floor((x + radius) / CELL);
  const z0 = Math.floor((z - radius) / CELL), z1 = Math.floor((z + radius) / CELL);
  stamp++;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const k = cellKey(cx, cz);
      if (k < 0) continue;
      const list = grid.get(k);
      if (!list) continue;
      for (const i of list) {
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        fn(boxes[i], i);
      }
    }
  }
}

/** A point in a box's own frame. `bx` runs along its width, `bz` along its depth. */
function toBox(b: CityBox, x: number, z: number, out: { bx: number; bz: number }): void {
  const dx = x - b.x, dz = z - b.z;
  out.bx = dx * b.cos + dz * b.sin;
  out.bz = -dx * b.sin + dz * b.cos;
}

const _bp = { bx: 0, bz: 0 };

/**
 * Is this point inside a building? City-local metres.
 *
 * Exact: the same six planes the renderer draws. Used by the checks to prove the collider IS the
 * drawn box, and by spawning to refuse to put a soldier in a wall.
 */
export function isInsideBuilding(x: number, y: number, z: number, margin = 0): boolean {
  if (!indexedCity) return false;
  let hit = false;
  forEachNear(x, z, margin + 2, (b) => {
    if (hit) return;
    if (y < -margin || y > b.h + margin) return;
    toBox(b, x, z, _bp);
    if (Math.abs(_bp.bx) <= b.hw + margin && Math.abs(_bp.bz) <= b.hd + margin) hit = true;
  });
  return hit;
}

/** The radius, in world units, of the city's own ground plane. Roofs are measured up from it. */
export function cityGroundRadius(): number {
  return indexedCity ? indexedCity.position.length() : 0;
}

/**
 * The building standing at this point, or null for open ground. Tallest wins where they overlap.
 *
 * Geoff: "if they are inside a building then instead put them on top of the building." This is how
 * a spawn point finds out which roof it is standing on, and how high that roof is.
 */
export function buildingAt(x: number, z: number): CityBox | null {
  if (!indexedCity) return null;
  let best: CityBox | null = null;
  forEachNear(x, z, 2, (b) => {
    toBox(b, x, z, _bp);
    if (Math.abs(_bp.bx) > b.hw || Math.abs(_bp.bz) > b.hd) return;
    if (!best || b.h > best.h) best = b;
  });
  return best;
}

/**
 * Keep a point inside a building's footprint. Returns true if it had to be moved.
 *
 * Geoff: "If they are on a building they stay there and don't fall off the edge." A clamp rather
 * than a bounce, and in the box's OWN frame, so a man walking at the parapet slides ALONG it instead
 * of stopping dead — the outward part of his step is removed and the part running along the edge
 * survives. Which is what a person on a roof does.
 */
export function clampToRoof(
  b: CityBox, x: number, z: number, inset: number, out: { x: number; z: number },
): boolean {
  toBox(b, x, z, _bp);
  // A parapet on a four-metre shed cannot be a metre and a half in from both sides; give ground
  // rather than pinning him to the exact centre of a tiny roof.
  const lw = Math.max(0, b.hw - Math.min(inset, b.hw * 0.4));
  const ld = Math.max(0, b.hd - Math.min(inset, b.hd * 0.4));
  const bx = Math.max(-lw, Math.min(lw, _bp.bx));
  const bz = Math.max(-ld, Math.min(ld, _bp.bz));
  if (bx === _bp.bx && bz === _bp.bz) { out.x = x; out.z = z; return false; }
  out.x = b.x + bx * b.cos - bz * b.sin;
  out.z = b.z + bx * b.sin + bz * b.cos;
  return true;
}

/**
 * Somewhere near here that is not inside a building.
 *
 * Pushing out of a wall works when a walker is barely in one. It does NOT work when he has been
 * dropped in the middle of a three-hundred-metre tower in the densest square kilometre on Earth: the
 * shortest way out is ninety metres, and it lands him inside the next tower, which pushes him back.
 * Measured — half of two hundred test spawns never escaped.
 *
 * So spawning does not push, it SEARCHES. A widening spiral of candidate points, first clear one
 * wins. Returns false if there is genuinely no room within the search, which the caller should treat
 * as "do not spawn here" rather than "spawn anyway".
 */
export function findFreeSpot(
  x: number, z: number, radius: number, out: { x: number; z: number }, maxMetres = 260,
): boolean {
  out.x = x; out.z = z;
  if (!indexedCity) return true;
  if (!isInsideBuilding(x, 1, z, radius)) return true;
  // Golden-angle spiral: even coverage with no preferred direction, so a crowd squeezed out of one
  // building does not all appear along the same line.
  const GOLDEN = 2.399963;
  for (let i = 1; i <= 220; i++) {
    const r = maxMetres * Math.sqrt(i / 220);
    const a = i * GOLDEN;
    const cx = x + Math.cos(a) * r;
    const cz = z + Math.sin(a) * r;
    if (!isInsideBuilding(cx, 1, cz, radius)) { out.x = cx; out.z = cz; return true; }
  }
  return false;
}

/**
 * Push a walker out of any building it has ended up inside. Returns true if it moved.
 *
 * The LAST line of defence, not the steering. Steering keeps them out; this catches the cases
 * steering cannot — spawning inside a tower, being shoved into one by a neighbour, a building
 * appearing when the city streams in. Without it a soldier who gets inside stays inside forever,
 * because from in there every direction looks equally blocked.
 *
 * Resolved along the box's SHALLOWEST axis, which is the shortest way out and therefore the one
 * that does not fling somebody across a city block.
 */
export function pushOutOfBuildings(
  x: number, z: number, radius: number, out: { x: number; z: number },
): boolean {
  out.x = x; out.z = z;
  if (!indexedCity) return false;

  // THE DEEPEST overlap, resolved once — not the sum of every overlap at once. Summing looks like
  // the obvious thing and is wrong: a walker wedged in a corner between two towers gets both pushes
  // applied together and is fired diagonally out of the block. One at a time, with the caller free
  // to call again, converges instead.
  let bestDepth = 0;
  let bx = 0, bz = 0;
  forEachNear(x, z, radius + 2, (b) => {
    toBox(b, x, z, _bp);
    const ox = b.hw + radius - Math.abs(_bp.bx);
    const oz = b.hd + radius - Math.abs(_bp.bz);
    if (ox <= 0 || oz <= 0) return;               // outside on at least one axis: no overlap
    // Out along the SHALLOWEST axis of this box: the shortest way to daylight.
    const depth = Math.min(ox, oz);
    if (depth <= bestDepth) return;
    bestDepth = depth;
    if (ox < oz) {
      const push = (_bp.bx >= 0 ? 1 : -1) * ox;
      bx = push * b.cos; bz = push * b.sin;
    } else {
      const push = (_bp.bz >= 0 ? 1 : -1) * oz;
      bx = -push * b.sin; bz = push * b.cos;
    }
  });
  if (bestDepth <= 0) return false;
  out.x = x + bx;
  out.z = z + bz;
  return true;
}

/** Push until clear, or give up. Four passes settles every case the checks could find. */
export function resolveBuildings(
  x: number, z: number, radius: number, out: { x: number; z: number },
): boolean {
  out.x = x; out.z = z;
  let moved = false;
  for (let i = 0; i < 6; i++) {
    if (!pushOutOfBuildings(out.x, out.z, radius, out)) break;
    moved = true;
  }
  return moved;
}

const _probe = { bx: 0, bz: 0 };

/**
 * Greedy avoidance: keep the heading you wanted unless a building is in the way, then slide along it.
 *
 * Geoff asked for "greedy pathfinding so they flow around", and greedy is the right word for what
 * this is and is not. There is no plan, no route and no map: each soldier looks a short way down the
 * line he wants to walk, and if a wall is there he walks along the wall instead, picking whichever
 * of the two ways round still points more toward where he was going. Round a convex tower that
 * produces exactly the flow asked for. In a dead-end courtyard it produces a soldier who walks into
 * the corner and mills about, which for a crowd of extras is a fair trade against a navmesh over
 * forty thousand buildings.
 *
 * `dx, dz` is the desired heading (unit). Writes the adjusted heading; returns true if it deflected.
 */
export function steerAroundBuildings(
  x: number, z: number, dx: number, dz: number,
  radius: number, lookahead: number,
  out: { x: number; z: number; side: number },
  minHeight = 0,
): boolean {
  out.x = dx; out.z = dz;
  if (!indexedCity) { out.side = 0; return false; }

  // CLEARANCE. Steering keeps a metre and a half further off the wall than the push-out uses, so a
  // soldier sliding along a face never dips inside and never triggers the last-resort push. Without
  // the gap the two fight: steering grazes the surface, the push shoves him off it, and he shudders
  // along the wall instead of walking down it.
  const clear = radius + 1.5;

  // The nearest wall along the intended path, not merely any wall nearby: a building beside a
  // soldier is not a reason to turn, and treating it as one makes a crowd swerve at nothing.
  let best: CityBox | null = null;
  let bestT = Infinity;
  const px = x + dx * lookahead, pz = z + dz * lookahead;
  const midX = (x + px) * 0.5, midZ = (z + pz) * 0.5;
  forEachNear(midX, midZ, lookahead * 0.5 + clear + 2, (b) => {
    // TALL ENOUGH TO BE WORTH WALKING ROUND. Geoff: "he walks through all the buildings and he
    // should walk around anything taller than 50m until we have some way for him to step up onto it
    // or destroy it." A soldier avoids everything (minHeight 0, the default); a 300 m Kaiju steps
    // over a villa and goes round a tower.
    if (b.h < minHeight) return;
    // Sample along the intended path. Cheaper than a proper segment-vs-rectangle test and, at four
    // samples over a lookahead about the size of a person's stride, indistinguishable from one.
    for (let s = 1; s <= 4; s++) {
      const t = (s / 4) * lookahead;
      toBox(b, x + dx * t, z + dz * t, _probe);
      if (Math.abs(_probe.bx) < b.hw + clear && Math.abs(_probe.bz) < b.hd + clear) {
        if (t < bestT) { bestT = t; best = b; }
        return;
      }
    }
  });
  if (!best) { out.side = 0; return false; }

  const b: CityBox = best;
  // Which wall am I facing? Whichever axis the approach is more perpendicular to.
  const alongW = Math.abs(dx * b.cos + dz * b.sin);
  const alongD = Math.abs(-dx * b.sin + dz * b.cos);
  let tx: number, tz: number;
  if (alongW > alongD) { tx = -b.sin; tz = b.cos; }      // width-facing wall: slide along depth
  else { tx = b.cos; tz = b.sin; }

  // COMMIT TO A SIDE, and this is the whole difference between flowing and shuddering.
  //
  // Greedily taking whichever way round still points at the target is right for the first step and
  // disastrous after it: as a soldier slides along a wall, the direction to his target swings, and
  // the moment it crosses the wall's line the "best" way round flips. He turns back, it flips again,
  // and he oscillates on the spot forever. Measured: pinned against a 300 m tower for 814 ticks,
  // travelling 0.7 m in all that time.
  //
  // So the side is chosen ONCE, when a wall is first met, and held until he is clear of everything.
  // The caller owns that memory because it belongs to the soldier, not to the wall.
  if (out.side === 0) out.side = (tx * dx + tz * dz) < 0 ? -1 : 1;
  tx *= out.side; tz *= out.side;

  // Blend rather than snap. A hard 90-degree turn the instant a wall enters the lookahead reads as
  // a crowd of robots; easing toward the tangent as the wall gets closer reads as people flowing.
  const urgency = Math.min(1, 1 - bestT / lookahead + 0.35);
  out.x = dx * (1 - urgency) + tx * urgency;
  out.z = dz * (1 - urgency) + tz * urgency;
  const len = Math.hypot(out.x, out.z);
  if (len > 1e-6) { out.x /= len; out.z /= len; } else { out.x = tx; out.z = tz; }
  return true;
}

const _a = new THREE.Vector3();
const _b2 = new THREE.Vector3();

/**
 * Where a bullet crosses the city, if it does. World in, world out.
 *
 * Returns the fraction along the segment, and writes the impact point and the wall's outward normal.
 * A slab test in each box's own frame — exact for a box, which is what these are.
 */
export function raycastCity(
  fromWorld: THREE.Vector3, toWorld: THREE.Vector3,
  outPoint: THREE.Vector3, outNormal: THREE.Vector3,
): number | null {
  if (!indexedCity) return null;
  if (!worldToCity(fromWorld, _a) || !worldToCity(toWorld, _b2)) return null;

  const dx = _b2.x - _a.x, dy = _b2.y - _a.y, dz = _b2.z - _a.z;
  let bestT = Infinity;
  let bestBox: CityBox | null = null;
  let bestAxis = 0;      // 0 = width face, 1 = roof/floor, 2 = depth face
  let bestSign = 1;

  const midX = (_a.x + _b2.x) * 0.5, midZ = (_a.z + _b2.z) * 0.5;
  const reach = Math.hypot(dx, dz) * 0.5 + CELL;
  forEachNear(midX, midZ, reach, (b) => {
    // Ray into the box's frame: rotate the XZ components, translate the origin.
    const ox = (_a.x - b.x) * b.cos + (_a.z - b.z) * b.sin;
    const oz = -(_a.x - b.x) * b.sin + (_a.z - b.z) * b.cos;
    const rx = dx * b.cos + dz * b.sin;
    const rz = -dx * b.sin + dz * b.cos;
    const oy = _a.y;

    let tmin = 0, tmax = 1;
    let axis = 0, sign = 1;
    // X slab
    for (let k = 0; k < 3; k++) {
      const o = k === 0 ? ox : k === 1 ? oy : oz;
      const r = k === 0 ? rx : k === 1 ? dy : rz;
      const lo = k === 1 ? 0 : -(k === 0 ? b.hw : b.hd);
      const hi = k === 1 ? b.h : (k === 0 ? b.hw : b.hd);
      if (Math.abs(r) < 1e-9) { if (o < lo || o > hi) { tmin = 1; tmax = 0; break; } continue; }
      let t1 = (lo - o) / r, t2 = (hi - o) / r;
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) break;
    }
    if (tmin > tmax || tmin < 0 || tmin > 1 || tmin >= bestT) return;
    bestT = tmin; bestBox = b; bestAxis = axis; bestSign = sign;
  });

  if (!bestBox) return null;
  const b: CityBox = bestBox;
  outPoint.set(_a.x + dx * bestT, _a.y + dy * bestT, _a.z + dz * bestT);
  cityToWorld(outPoint, outPoint);
  // Face normal, back out of the box's frame.
  if (bestAxis === 1) outNormal.set(0, bestSign, 0);
  else if (bestAxis === 0) outNormal.set(bestSign * b.cos, 0, bestSign * b.sin);
  else outNormal.set(-bestSign * b.sin, 0, bestSign * b.cos);
  cityDirToWorld(outNormal, outNormal);
  return bestT;
}


/**
 * The arena's building-avoidance hook, in world terms.
 *
 * Lives here because everything it needs is here, and is handed to the arena at runtime rather than
 * imported by it — the simulation must not depend on the city, which reaches the database. Returns
 * false when there is no city, when nothing tall is in the way, or when the Kaiju is outside the
 * indexed area, in which case the caller keeps its own heading.
 */
const _steerPos = new THREE.Vector3();
const _steerDir = new THREE.Vector3();
const _steerRes = { x: 0, z: 0, side: 0 };
export function steerKaijuAroundBuildings(
  worldPos: THREE.Vector3, worldDir: THREE.Vector3,
  radiusM: number, lookaheadM: number, minHeightM: number, out: THREE.Vector3,
): boolean {
  if (!ensureCityColliders()) return false;
  const here = worldToCity(worldPos, _steerPos);
  const dir = worldDirToCity(worldDir, _steerDir);
  if (!here || !dir) return false;
  if (!steerAroundBuildings(here.x, here.z, dir.x, dir.z, radiusM, lookaheadM, _steerRes, minHeightM)) {
    return false;
  }
  _steerDir.set(_steerRes.x, 0, _steerRes.z);
  cityDirToWorld(_steerDir, out);
  return true;
}
