// kaijuArena — three Kaiju at Mount Everest, fighting under the utility/behaviour-tree brain.
//
// This is the first thing in the project that is a GAME rather than a world. Everything is
// recorded: perception, every action's score, decisions, damage, deaths. The tracker panel reads
// this, and there is a copy button, because the only way to tune a utility system is to read what
// it actually saw and chose.
//
// The player is agent 0 and holds the flamethrower (Geoff's pick). The other two are AI.

import * as THREE from 'three';
import { BehaviourTree, State } from 'mistreevous';
import {
  createKaijuBody, stepBodyOf, placeBodyOnSurface, reTangentOf, rightVectorOf,
  body as playerBody, type KaijuBody,
} from './kaijuBody';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import {
  WEAPONS, fireWeapon, stepProjectiles, resolveMelee, clearProjectiles,
  type WeaponId, type HitTarget,
} from './kaijuWeapons';
import {
  scoreActions, chooseAction, ACTION_TREES, describeChoice, refusalReason,
  type ActionId, type ActionScore, type Perception,
} from './kaijuBrain';
import {
  parseOrder, orderWeight, orderExpired, ORDER_ACTION, ORDER_LABEL, type Order,
} from './kaijuOrders';
import {
  BREEDS, derive, describeBuild, STAT_NAMES,
  type KaijuBuild, type DerivedStats,
} from './kaijuStats';
import { seedKaiju, rand } from './kaijuRandom';
import { FLASH_SECONDS } from './kaijuFlash';
import {
  torsoCapsule, capsuleOverlap, limbCapsules, pointToCapsule, type Capsule,
} from './kaijuColliders';

/** Mount Everest. The arena floor is the highest ground on the planet, which is a fine stage. */
export const ARENA_LAT = 27.9881;
export const ARENA_LON = 86.9250;

// NOTE: there is deliberately no MAX_HEALTH constant any more. Health comes from each Kaiju's
// Vigour stat, so it differs per build (a Bastion has 840, a Reaver 560). A shared constant was
// left behind after the stat system landed and made the tracker report everyone's health out of
// 1000, which is wrong for every build. Read `agent.maxHealth`.
/** All three start identical, per Geoff: same size, same health, different weapons. */
export const ARENA_HEIGHT = 3;      // units = 300 m

export interface Agent {
  id: string;
  name: string;
  /** Monster catalog type, so each is a visually different Kaiju. */
  monsterType: number;
  weapon: WeaponId;
  isPlayer: boolean;
  /** The design this Kaiju was built from. */
  build: KaijuBuild;
  /** Cached numbers the simulation reads every frame. */
  d: DerivedStats;
  body: KaijuBody;
  health: number;
  maxHealth: number;
  /** Set once the first blow of a fight has landed, for Ambusher. */
  hasStruck: boolean;
  alive: boolean;
  action: ActionId | null;
  scores: ActionScore[];
  perception: Perception | null;
  cooldown: number;
  timeSinceHit: number;
  /** Seconds spent in the current action; the brain's commitment window uses this. */
  timeInAction: number;
  damageDealt: number;
  damageTaken: number;
  /** Counted so the tracker can distinguish "never fired" from "fired and missed". */
  shotsFired: number;
  hitsLanded: number;
  killedBy: string | null;
  /** Behaviour-tree instance for the current action. */
  tree: BehaviourTree | null;
  /** Stable action board the tree is bound to; `dt` is refreshed each step. */
  board: ReturnType<typeof makeBoard> | null;
  treeAction: ActionId | null;
  lastTreeState: string;
  /** Strafe direction, flipped occasionally so circling is not perfectly predictable. */
  strafeSign: number;
  wanderTurn: number;
  /**
   * Movement the behaviour tree asked for this tick.
   *
   * The tree writes intent; `stepArena` performs a single integration from it. See the note on
   * `move` in makeBoard for why the tree must not move the body itself.
   */
  intentMove: boolean;
  intentDir: THREE.Vector3;
  intentRun: boolean;
  intentSpeedMul: number;
  /** What the player last told this Kaiju to do, if anything. */
  order: Order | null;
  /**
   * Why it is not complying, as a STATE not a sentence — 'too hurt', 'outmatched'.
   *
   * Kaiju do not talk. This used to be dialogue ("No — I'm too hurt.") which was wrong for a
   * monster and, more to the point, answered the wrong question: what needs confirming is that
   * the system parsed your words, not that the creature has a personality.
   */
  refusalNote: string;
  /** True while the Kaiju is disobeying a live order. */
  refusing: boolean;
  /** Whether it has answered the current order yet (agreed or refused). */
  orderAnswered: boolean;
  /** Reusable body capsule, refreshed each tick. */
  capsule: Capsule;
  /**
   * Tangent knockback velocity, in units/sec, decaying over time.
   *
   * A 300 m creature taking a hit should be MOVED by it. Without this a blow was a number on a
   * health bar and nothing else, which is the main reason the fight read as two models overlapping
   * rather than as anything physical.
   */
  knock: THREE.Vector3;
  /** Seconds of staggering left, during which it cannot act. */
  stagger: number;
  /**
   * Seconds left in the "I heard you" flash.
   *
   * Set the moment a command is UNDERSTOOD, regardless of whether the Kaiju goes on to obey it.
   * That distinction is the point: hearing you and agreeing with you are different things, and the
   * flash and the command word on screen confirm the first; whether it then obeys is a separate
   * matter, shown as its state rather than spoken. Kaiju do not talk.
   */
  ackFlash: number;
}

export interface ArenaEvent { t: number; text: string }

const agents: Agent[] = [];
const events: ArenaEvent[] = [];
let clock = 0;
let started = false;
let treeErrorReported = false;
/** Scratch for the per-tick processing order; module-level so it is not reallocated each frame. */
const order: number[] = [];

/**
 * Change notification.
 *
 * WITHOUT THIS THE OPPONENTS NEVER APPEAR. KaijuArenaScene reads `arenaStarted()` during render
 * and returns null when no fight is on. Starting a battle only mutates module state, so React was
 * never told anything had changed: the component mounted showing nothing and stayed that way
 * forever, which is exactly the "I only see my own Kaiju" symptom. `version` bumps on every
 * start/reset/stop and the scene subscribes to it.
 */
const arenaListeners = new Set<() => void>();
let version = 0;

export function subscribeArena(fn: () => void): () => void {
  arenaListeners.add(fn);
  return () => { arenaListeners.delete(fn); };
}
export function arenaVersion(): number { return version; }
function emitArena(): void { version++; for (const l of arenaListeners) l(); }

export function getAgents(): Agent[] { return agents; }
export function getEvents(): ArenaEvent[] { return events; }
export function arenaClock(): number { return clock; }
export function arenaStarted(): boolean { return started; }

function log(text: string): void {
  events.push({ t: Math.round(clock * 10) / 10, text });
  if (events.length > 400) events.splice(0, events.length - 400);
}

const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _kb = new THREE.Vector3();
const _axis = new THREE.Vector3();

/** Peak knockback speed, units/sec, for a blow worth ~8% of the victim's health. */
const KNOCK_SPEED = 0.55;
/** How fast knockback bleeds off (per second). */
const KNOCK_DECAY = 3.2;

function centreOf(a: Agent, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a.body.dir).multiplyScalar(a.body.radius + ARENA_HEIGHT * 0.5);
}
export function feetOf(a: Agent, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a.body.dir).multiplyScalar(a.body.radius);
}

/**
 * Set up a fight from a list of BUILDS.
 *
 * Everything that makes two Kaiju different now comes from `kaijuStats.ts` — health, damage,
 * armour, rate, speed, how well it plays and how readily it obeys. `initArena` keeps the old
 * three-Kaiju demo working by handing in three breeds.
 */
export function initArenaWith(builds: KaijuBuild[], seed = 0x5EED, spreadBodies = 6): THREE.Vector3 {
  agents.length = 0;
  events.length = 0;
  clearProjectiles();
  clock = 0;
  treeErrorReported = false;
  seedKaiju(seed);

  const d = new Float64Array(3);
  latLonToDirection(ARENA_LAT, ARENA_LON, d);
  const centre = new THREE.Vector3(d[0], d[1], d[2]).normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), centre).normalize();
  const north = new THREE.Vector3().crossVectors(centre, east).normalize();

  const R = ARENA_HEIGHT * spreadBodies;
  builds.forEach((build, i) => {
    const ang = (i / builds.length) * Math.PI * 2;
    const off = east.clone().multiplyScalar(Math.cos(ang) * R).addScaledVector(north, Math.sin(ang) * R);
    const dir = centre.clone().add(off.multiplyScalar(1 / PLANET_RADIUS)).normalize();
    // The player's agent REUSES the shared player body rather than getting its own. That is what
    // makes the walk controller, the third-person camera and the existing HUD drive agent 0 with
    // no extra plumbing, and it means the arena reads exactly the body the player is moving.
    const body = i === 0 ? playerBody : createKaijuBody();
    const facing = centre.clone().sub(dir).normalize();
    placeBodyOnSurface(body, dir, facing);
    const der = derive(build);
    agents.push({
      id: `k${i}`, name: build.name, monsterType: build.monsterType, weapon: build.weapon,
      isPlayer: i === 0, build, d: der,
      body, health: der.maxHealth, maxHealth: der.maxHealth, alive: true, hasStruck: false,
      action: null, scores: [], perception: null,
      // A small random opening delay, so two identical Kaiju do not fire in lockstep forever.
      cooldown: rand() * 0.3, timeSinceHit: 99, timeInAction: 0, damageDealt: 0, damageTaken: 0,
      shotsFired: 0, hitsLanded: 0, killedBy: null,
      tree: null, board: null, treeAction: null, lastTreeState: '-',
      strafeSign: i % 2 === 0 ? 1 : -1, wanderTurn: 0,
      intentMove: false, intentDir: new THREE.Vector3(0, 0, 1), intentRun: false, intentSpeedMul: 1,
      order: null, refusalNote: '', refusing: false, orderAnswered: false, ackFlash: 0,
      capsule: torsoCapsule(dir, body.radius, ARENA_HEIGHT),
      knock: new THREE.Vector3(), stagger: 0,
    });
  });

  started = true;
  emitArena();
  for (const b of builds) log(describeBuild(b));
  return agents[0].body.dir.clone();
}

/**
 * The demo fight: you plus THREE opponents at Mount Everest, each a different model.
 *
 * Agent 0 is always the player, so the list is one breed for you and three to fight.
 */
export function initArena(_playerType?: number): THREE.Vector3 {
  return initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]]);
}

/** Is there ground between two points higher than the line joining them? Cheap cover test. */
function coverBetween(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    _tmp.copy(from).lerp(to, t);
    const len = _tmp.length();
    if (len < 1e-6) continue;
    const m = sampleGlobeSurface(_tmp.x / len, _tmp.y / len, _tmp.z / len);
    if (m == null) continue;
    // Ground rises above the sight line by more than a third of a body height.
    if (PLANET_RADIUS + m / METRES_PER_UNIT > len + ARENA_HEIGHT * 0.33) return true;
  }
  return false;
}

function perceive(a: Agent): Perception {
  let best: Agent | null = null;
  let bestD = Infinity;
  let threats = 0;
  const me = centreOf(a, new THREE.Vector3());
  for (const o of agents) {
    if (o === a || !o.alive) continue;
    const d = me.distanceTo(centreOf(o, _tmp)) / ARENA_HEIGHT;
    if (d < 5) threats++;
    if (d < bestD) { bestD = d; best = o; }
  }
  // Power ratio from remaining health and weapon damage-per-second, WEIGHTED BY REACH.
  //
  // Raw damage-per-second is a bad threat estimate on its own: the flamethrower's nominal DPS is
  // several times the cannon's, so from ten body-lengths away — where it cannot touch anybody —
  // both other Kaiju judged it terrifying and fled. A weapon that cannot reach you right now is
  // not currently a threat, so reach is folded in.
  const rawDps = (x: Agent) =>
    (WEAPONS[x.weapon].damage * WEAPONS[x.weapon].count * x.d.damageMul * x.d.rateMul)
    / Math.max(0.05, WEAPONS[x.weapon].cooldown);
  const reach = (x: Agent, distBodies: number) =>
    Math.min(1, WEAPONS[x.weapon].rangeBodies / Math.max(0.5, distBodies));
  const dist = best ? bestD : 999;
  const mine = rawDps(a) * reach(a, dist) * (a.health / a.maxHealth);
  const theirs = best ? rawDps(best) * reach(best, dist) * (best.health / best.maxHealth) : 0;
  // The same comparison again, but imagining we have already closed to our own effective range.
  const myRange = WEAPONS[a.weapon].rangeBodies;
  const mineClosed = rawDps(a) * (a.health / a.maxHealth);
  const theirsClosed = best ? rawDps(best) * reach(best, myRange) * (best.health / best.maxHealth) : 0;
  return {
    selfId: a.id,
    healthFrac: a.health / a.maxHealth,
    targetId: best?.id ?? null,
    targetDistBodies: best ? bestD : 999,
    powerRatio: mine > 0 ? theirs / mine : 1,
    powerRatioClosed: mineClosed > 0 ? theirsClosed / mineClosed : 1,
    threatCount: threats,
    weaponRangeBodies: WEAPONS[a.weapon].rangeBodies,
    weapon: a.weapon,
    coverNearby: best ? coverBetween(me, centreOf(best, _tmp)) : false,
    timeSinceHit: Math.round(a.timeSinceHit * 10) / 10,
    instinct: a.d.instinct01,
    obedience: a.d.obedience01,
    orderedAction: a.order ? (ORDER_ACTION[a.order.type] as ActionId | null) : null,
    orderWeight: a.order ? orderWeight(a.d.obedience01) : 0,
    neverFlees: a.build.abilities.includes('relentless'),
    // Terrifying enemies within a few body-lengths make this one break off sooner.
    fearPressure: agents.reduce((n, o) => (
      o !== a && o.alive && o.build.abilities.includes('terrifying')
        && me.distanceTo(centreOf(o, new THREE.Vector3())) / ARENA_HEIGHT < 6 ? n + 0.6 : n
    ), 0),
  };
}

function targetOf(a: Agent): Agent | null {
  const id = a.perception?.targetId;
  return id ? agents.find((x) => x.id === id && x.alive) ?? null : null;
}

/** Board of the actions the tree can call. Each returns a Mistreevous State. */
function makeBoard(a: Agent) {
  // `dt` is refreshed by the caller each step. Mistreevous binds this object at construction, so
  // it must be stable for the life of the tree rather than rebuilt per frame.
  const ctx = { dt: 1 / 60 };
  /**
   * Record where this Kaiju wants to go. It does NOT move the body.
   *
   * The tree used to integrate the body itself, and then `stepArena` integrated it AGAIN to apply
   * gravity — so a moving agent was stepped twice per tick. That was harmless before the body had
   * momentum (the second call had no input, so it did nothing horizontally) but once the body
   * carried speed between frames the second call coasted it forward a second time. Measured
   * result: AI Kaiju travelled 1.72x too far and fell under gravity twice.
   *
   * So movement is now an INTENT the tree writes and `stepArena` acts on exactly once.
   */
  const move = (dirWorld: THREE.Vector3, run: boolean, closing = false) => {
    reTangentOf(a.body, dirWorld);
    a.intentDir.copy(dirWorld);
    a.intentMove = true;
    a.intentRun = run;
    // Speed scales the step, which leaves the sphere-rotation maths in stepBodyOf untouched.
    // Sprinter adds a burst, but only while closing on an enemy — that is what makes it a
    // short-range fighter's ability rather than simply more Speed.
    a.intentSpeedMul = a.d.moveMul * (closing && a.build.abilities.includes('sprinter') ? 1.35 : 1);
  };
  const faceTarget = () => {
    const t = targetOf(a);
    if (!t) return false;
    _aim.copy(centreOf(t, _tmp)).sub(centreOf(a, new THREE.Vector3()));
    reTangentOf(a.body, _aim);
    a.body.forward.lerp(_aim, Math.min(1, ctx.dt * 3)).normalize();
    reTangentOf(a.body, a.body.forward);
    return true;
  };

  return {
    ctx,
    // Mistreevous requires CONDITION functions to return a plain boolean and ACTION functions to
    // return a State. Returning a State from a condition throws at step time, which would leave the
    // Kaiju silently frozen. Verified against mistreevous 4.3.1 directly.
    HasTarget: () => targetOf(a) != null,
    InMeleeRange: () => (a.perception?.targetDistBodies ?? 999) <= WEAPONS.melee.rangeBodies + 0.4,
    InWeaponRange: () => (a.perception?.targetDistBodies ?? 999) <= WEAPONS[a.weapon].rangeBodies,
    TooClose: () => (a.perception?.targetDistBodies ?? 999) < WEAPONS[a.weapon].rangeBodies * 0.35,

    FaceTarget: () => (faceTarget() ? State.SUCCEEDED : State.FAILED),
    FaceAwayFromTarget: () => {
      const t = targetOf(a);
      if (!t) return State.FAILED;
      _aim.copy(centreOf(a, new THREE.Vector3())).sub(centreOf(t, _tmp));
      reTangentOf(a.body, _aim);
      a.body.forward.lerp(_aim, Math.min(1, ctx.dt * 3)).normalize();
      reTangentOf(a.body, a.body.forward);
      return State.SUCCEEDED;
    },
    MoveToTarget: () => {
      const t = targetOf(a);
      if (!t) return State.FAILED;
      _aim.copy(centreOf(t, _tmp)).sub(centreOf(a, new THREE.Vector3()));
      move(_aim, true, true);
      return State.SUCCEEDED;
    },
    BackAway: () => {
      const t = targetOf(a);
      if (!t) return State.FAILED;
      _aim.copy(centreOf(a, new THREE.Vector3())).sub(centreOf(t, _tmp));
      move(_aim, false);
      return State.SUCCEEDED;
    },
    RunAway: () => {
      const t = targetOf(a);
      if (!t) return State.FAILED;
      _aim.copy(centreOf(a, new THREE.Vector3())).sub(centreOf(t, _tmp));
      move(_aim, true);
      return State.SUCCEEDED;
    },
    Strafe: () => {
      rightVectorOf(a.body, _aim);
      _aim.multiplyScalar(a.strafeSign);
      move(_aim, false);
      if (rand() < ctx.dt * 0.25) a.strafeSign *= -1;
      return State.SUCCEEDED;
    },
    MoveToCover: () => {
      // Simplest useful cover query: step away from the target and downhill-ish, which on real
      // terrain puts a ridge between you surprisingly often. A full EQS-style query is the next
      // step (see docs/KAIJU_AI_RESEARCH.md).
      const t = targetOf(a);
      if (!t) return State.FAILED;
      _aim.copy(centreOf(a, new THREE.Vector3())).sub(centreOf(t, _tmp));
      rightVectorOf(a.body, _tmp);
      _aim.addScaledVector(_tmp, a.strafeSign * 0.8);
      move(_aim, true);
      return State.SUCCEEDED;
    },
    // --- ordered behaviours ---
    Idle: () => State.SUCCEEDED,
    AtDestination: () => {
      const d = a.order?.destination;
      if (!d) return true;                       // no destination = already there
      return a.body.dir.angleTo(d) * PLANET_RADIUS < ARENA_HEIGHT * 1.5;
    },
    MoveToDestination: () => {
      const d = a.order?.destination;
      if (!d) return State.FAILED;
      // Walk the great circle toward it: the tangent component of the destination direction.
      _aim.copy(d);
      reTangentOf(a.body, _aim);
      move(_aim, true);
      return State.SUCCEEDED;
    },
    Wander: () => {
      a.wanderTurn += (rand() - 0.5) * ctx.dt;
      _aim.copy(a.body.forward);
      _aim.applyAxisAngle(a.body.dir, a.wanderTurn * ctx.dt);
      move(_aim, false);
      return State.SUCCEEDED;
    },
    MeleeAttack: () => {
      if (a.cooldown > 0) return State.FAILED;
      a.cooldown = WEAPONS.melee.cooldown / a.d.rateMul;
      a.shotsFired++;
      const hits = resolveMelee(a.id, centreOf(a, new THREE.Vector3()), a.body.forward, ARENA_HEIGHT, hitTargets());
      applyHits(hits);
      return State.SUCCEEDED;
    },
    FireWeapon: () => {
      if (a.cooldown > 0) return State.FAILED;
      const t = targetOf(a);
      if (!t) return State.FAILED;
      a.cooldown = WEAPONS[a.weapon].cooldown / a.d.rateMul;
      a.shotsFired++;
      const from = centreOf(a, new THREE.Vector3());
      _aim.copy(centreOf(t, _tmp)).sub(from).normalize();
      // Lead the shot upward a little for the arcing weapons, so a grenade actually lands on them.
      if (a.weapon === 'grenade' || a.weapon === 'gun') {
        const dist = a.perception?.targetDistBodies ?? 1;
        _up.copy(a.body.dir);
        const lift = a.weapon === 'grenade' ? 0.32 : 0.05;
        _aim.addScaledVector(_up, Math.min(0.6, (dist / WEAPONS[a.weapon].rangeBodies) * lift)).normalize();
      }
      fireWeapon(a.id, a.weapon, from.addScaledVector(a.body.forward, ARENA_HEIGHT * 0.35), _aim, ARENA_HEIGHT);
      return State.SUCCEEDED;
    },
  };
}

function hitTargets(): HitTarget[] {
  return agents.map((a) => ({
    id: a.id,
    centre: centreOf(a, new THREE.Vector3()),
    radius: ARENA_HEIGHT * 0.42,
    alive: a.alive,
  }));
}

/**
 * Turn a raw weapon hit into damage actually taken.
 *
 * Order matters and is the conventional one: scale by the attacker's output first, then apply the
 * defender's reduction. Abilities hook in on both sides.
 */
function resolveDamage(raw: number, weapon: WeaponId, src: Agent | undefined, t: Agent): number {
  let dmg = raw;

  if (src) {
    dmg *= src.d.damageMul;
    // Berserker: up to double damage as health runs out. The comeback ability.
    if (src.build.abilities.includes('berserker')) {
      dmg *= 1 + (1 - src.health / src.maxHealth);
    }
    // Ambusher: the opening blow of the fight lands twice as hard.
    if (!src.hasStruck && src.build.abilities.includes('ambusher')) dmg *= 2;
    src.hasStruck = true;
  }

  // Defender's armour, on the MOBA curve so it never reaches immunity.
  let reduction = t.d.damageReduction;
  // Thick Hide is ranged-only, which is what makes it a shape rather than just more armour.
  if (t.build.abilities.includes('thickHide') && weapon !== 'melee') reduction += (1 - reduction) * 0.3;
  // Bulwark: much tougher standing your ground, much softer once you run.
  if (t.build.abilities.includes('bulwark')) {
    if (t.action === 'flee') reduction *= 0.4;
    else reduction += (1 - reduction) * 0.25;
  }
  if (weapon === 'flame' && t.build.abilities.includes('flameWard')) reduction += (1 - reduction) * 0.7;

  return dmg * (1 - Math.min(0.95, reduction));
}

function applyHits(hits: { targetId: string; ownerId: string; weapon: WeaponId; damage: number }[]): void {
  for (const h of hits) {
    const t = agents.find((a) => a.id === h.targetId);
    const src = agents.find((a) => a.id === h.ownerId);
    if (!t || !t.alive) continue;
    const dmg = resolveDamage(h.damage, h.weapon, src, t);
    t.health = Math.max(0, t.health - dmg);
    t.damageTaken += dmg;
    t.timeSinceHit = 0;
    if (src) { src.damageDealt += dmg; src.hitsLanded++; }

    // KNOCKBACK. A blow should move a body, not just decrement a number. Scaled by damage
    // relative to the victim's own health, so a scratch nudges and a heavy hit visibly throws it.
    if (src) {
      _kb.copy(centreOf(t, _tmp)).sub(centreOf(src, new THREE.Vector3()));
      reTangentOf(t.body, _kb);
      const share = Math.min(1, dmg / Math.max(1, t.maxHealth * 0.08));
      t.knock.addScaledVector(_kb, share * KNOCK_SPEED);
      // Heavy blows also interrupt: a staggered Kaiju cannot act for a moment, which is what
      // makes a melee exchange read as a real trade rather than two loops running side by side.
      if (share > 0.5 && h.weapon === 'melee') t.stagger = Math.max(t.stagger, 0.7);
    }
    if (t.health <= 0) {
      t.alive = false;
      t.killedBy = src?.name ?? null;
      log(`${t.name} was killed by ${src?.name ?? 'unknown'}`);
    }
  }
}

/** One simulation step. Called from the arena component's frame loop. */
export function stepArena(dt: number, playerControlled: boolean): void {
  if (!started) return;
  clock += dt;

  // PROCESS AGENTS IN A SHUFFLED ORDER.
  //
  // Iterating the list in order gives agent 0 a systematic advantage: with equal cooldowns
  // everyone fires on the same tick, and whoever is handled first lands their damage first. Over a
  // long duel that decides the fight on its own. The balance simulator found it immediately —
  // every matchup came out 100%/0% purely on seating position, so swapping sides produced a
  // meaningless flat 50% and made Instinct and Obedience look worthless when both in fact work.
  //
  // The shuffle uses the seeded stream, so runs stay reproducible.
  order.length = 0;
  for (let i = 0; i < agents.length; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const idx of order) {
    const a = agents[idx];
    if (!a.alive) continue;
    a.cooldown = Math.max(0, a.cooldown - dt);
    a.timeSinceHit += dt;

    // Age the order and drop it once stale. An immediate order that fires half a minute later,
    // when the situation has completely changed, is the classic way an obedient AI looks broken.
    if (a.order) {
      a.order.age += dt;
      if (orderExpired(a.order)) {
        log(`${a.name}: "${a.order.said}" has expired`);
        a.order = null;
        a.refusing = false;
        a.orderAnswered = false;
      }
    }
    // Vigour regrows health, but only once nothing has hit you for a few seconds, so it decides
    // how often a Kaiju can fight rather than how long it survives one fight.
    if (a.timeSinceHit > 5 && a.health < a.maxHealth) {
      a.health = Math.min(a.maxHealth, a.health + a.d.regenPerSec * dt);
    }

    // The player's Kaiju is driven by the walk controller; it still perceives so the tracker can
    // show what the AI WOULD have decided, which is a useful way to sanity-check the curves.
    a.perception = perceive(a);
    a.scores = scoreActions(a.perception);
    a.timeInAction += dt;
    const picked = chooseAction(a.scores, a.action, a.timeInAction);
    if (picked.action !== a.action) {
      log(`${a.name}: ${a.action ?? 'start'} -> ${describeChoice(picked)}`);
      a.action = picked.action;
      a.timeInAction = 0;
    }

    // Did it do what it was told? Refusal is not a branch anywhere — it is simply the ordered
    // action having lost the contest, which the scores above already explain.
    if (a.order) {
      const wanted = ORDER_ACTION[a.order.type] as ActionId | null;
      const refusing = wanted != null && a.action !== wanted;
      // Answer on the FIRST evaluation as well as on every change of mind. Without the
      // first-evaluation case a Kaiju that simply agrees says nothing at all, and an order you
      // cannot tell was received is worse than no order.
      if (refusing !== a.refusing || !a.orderAnswered) {
        a.orderAnswered = true;
        a.refusing = refusing;
        a.refusalNote = refusing ? (refusalReason(a.scores, wanted, a.action) ?? 'unwilling') : '';
        log(refusing
          ? `${a.name} REFUSES ${ORDER_LABEL[a.order.type]} — ${a.refusalNote}`
          : `${a.name} obeys ${ORDER_LABEL[a.order.type]}`);
      }
    }
    if (a.ackFlash > 0) a.ackFlash = Math.max(0, a.ackFlash - dt);

    // Carry knockback: slide along the surface and bleed off. Applied before the tree runs so a
    // staggered Kaiju is still visibly pushed around while it cannot act.
    if (a.knock.lengthSq() > 1e-8) {
      reTangentOf(a.body, a.knock);
      const speed = a.knock.length();
      _tmp.crossVectors(a.body.dir, a.knock).normalize();
      a.body.dir.applyAxisAngle(_tmp, -(speed * dt) / Math.max(1, a.body.radius)).normalize();
      reTangentOf(a.body, a.body.forward);
      a.knock.multiplyScalar(Math.max(0, 1 - KNOCK_DECAY * dt));
      if (a.knock.lengthSq() < 1e-8) a.knock.set(0, 0, 0);
    }
    if (a.stagger > 0) { a.stagger = Math.max(0, a.stagger - dt); continue; }

    // WHO DRIVES THE PLAYER'S KAIJU.
    //
    // Normally you do, directly, with the movement keys. But the moment you give it an ORDER it
    // takes over and carries the order out itself — that is the entire point of commanding a
    // creature rather than puppeting one. Say "free" (or move it yourself once the order expires)
    // and you have the controls back.
    if (a.isPlayer && playerControlled && !a.order) continue;

    // Fresh intent every tick: a tree that asks for nothing this frame means "stand still", not
    // "keep doing whatever you asked for last frame".
    a.intentMove = false;
    a.intentRun = false;
    a.intentSpeedMul = 1;

    if (!a.board) a.board = makeBoard(a);
    a.board.ctx.dt = dt;
    if (a.treeAction !== a.action || !a.tree) {
      try {
        a.tree = new BehaviourTree(ACTION_TREES[a.action], a.board);
        a.treeAction = a.action;
      } catch (e) {
        console.error('[kaiju] bad behaviour tree for', a.action, e);
        a.tree = null;
      }
    }
    if (a.tree) {
      try {
        a.tree.step();
        a.lastTreeState = String(a.tree.getState());
      } catch (e) {
        a.lastTreeState = 'ERROR';
        if (!treeErrorReported) { treeErrorReported = true; console.error('[kaiju] tree step failed', a.action, e); }
      }
    }

    // THE ONE AND ONLY body integration for this agent this tick. Whether the tree asked for
    // movement or not, the body advances exactly once, so gravity is applied exactly once.
    stepBodyOf(
      a.body, dt * (a.intentMove ? a.intentSpeedMul : 1),
      a.intentMove ? 1 : 0, 0, false,
      a.intentMove && a.intentRun, ARENA_HEIGHT,
      a.intentMove ? a.intentDir : null,
    );
  }

  // --- BODY SEPARATION -------------------------------------------------------------------------
  //
  // Run AFTER every body has moved, so it resolves the positions that actually exist rather than
  // half of this tick's and half of last tick's. Two 300 m creatures must not occupy one space;
  // without this they walked straight through each other and circled while overlapping, which is
  // exactly what "spinning in circles inside each other" looks like.
  for (const a of agents) {
    if (!a.alive) continue;
    torsoCapsule(a.body.dir, a.body.radius, ARENA_HEIGHT, a.capsule);
  }
  // Several relaxation passes, because resolving one pair can push a body into another. A single
  // pass left them touching at about 97% of their combined width — visibly clipping. Three passes
  // is enough for four bodies and costs nothing at this count.
  for (let pass = 0; pass < 3; pass++) {
  for (let i = 0; i < agents.length; i++) {
    const A = agents[i];
    if (!A.alive) continue;
    for (let j = i + 1; j < agents.length; j++) {
      const B = agents[j];
      if (!B.alive) continue;
      const depth = capsuleOverlap(A.capsule, B.capsule, _axis);
      if (depth <= 0) continue;
      // Push both apart along the surface, half each, so neither is privileged. Projected onto
      // the tangent plane: separation must not shove anybody into the ground or into the sky.
      reTangentOf(A.body, _axis);
      const push = depth * 0.55;
      const angA = push / Math.max(1, A.body.radius);
      const angB = push / Math.max(1, B.body.radius);
      _tmp.crossVectors(A.body.dir, _axis).normalize();
      A.body.dir.applyAxisAngle(_tmp, -angA).normalize();
      _tmp.crossVectors(B.body.dir, _axis).normalize();
      B.body.dir.applyAxisAngle(_tmp, angB).normalize();
      reTangentOf(A.body, A.body.forward);
      reTangentOf(B.body, B.body.forward);
    }
  }
    // Refresh after each pass, or later passes resolve against stale positions.
    for (const a of agents) {
      if (a.alive) torsoCapsule(a.body.dir, a.body.radius, ARENA_HEIGHT, a.capsule);
    }
  }

  const hits = stepProjectiles(dt, hitTargets(), (p) => {
    const len = p.length();
    if (len < 1e-6) return null;
    const m = sampleGlobeSurface(p.x / len, p.y / len, p.z / len);
    return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
  });
  if (hits.length) applyHits(hits);
}

/**
 * Fire the PLAYER's weapon this frame, or swing.
 *
 * Kept here rather than in the input layer so the cooldowns, the hit test and the damage
 * bookkeeping are the same code the AI uses. The player gets no special case beyond who decides
 * when to pull the trigger.
 */
export function playerAttack(kind: 'weapon' | 'melee'): void {
  const a = agents.find((x) => x.isPlayer);
  if (!a || !a.alive || a.cooldown > 0) return;
  const from = centreOf(a, new THREE.Vector3());
  if (kind === 'melee') {
    a.cooldown = WEAPONS.melee.cooldown / a.d.rateMul;
    a.shotsFired++;
    applyHits(resolveMelee(a.id, from, a.body.forward, ARENA_HEIGHT, hitTargets()));
    return;
  }
  a.cooldown = WEAPONS[a.weapon].cooldown / a.d.rateMul;
  a.shotsFired++;
  _aim.copy(a.body.forward).normalize();
  fireWeapon(a.id, a.weapon, from.addScaledVector(a.body.forward, ARENA_HEIGHT * 0.35), _aim, ARENA_HEIGHT);
}

/** Health of the player's Kaiju, for the HUD. */
export function playerAgent(): Agent | null { return agents.find((x) => x.isPlayer) ?? null; }

export interface OrderResult { understood: boolean; order: Order | null; text: string }

/**
 * Tell your Kaiju something, in words. Voice and typing both land here.
 *
 * `understood: false` means the local grammar drew a blank and the caller should escalate to the
 * language model — a null result is a routing decision, not an error.
 *
 * Note what this does NOT do: it does not make the Kaiju obey. It records what you asked for, and
 * the utility contest each tick decides whether the order wins.
 */
export function commandKaiju(text: string, agentId?: string): OrderResult {
  const a = agentId ? agents.find((x) => x.id === agentId) : agents.find((x) => x.isPlayer);
  if (!a || !a.alive) return { understood: false, order: null, text };

  const order = parseOrder(text);
  if (!order) return { understood: false, order: null, text };
  return { understood: true, order: applyOrder(a, order), text };
}

/** Attach an already-parsed order (from the grammar, the model, or a map click). */
export function applyOrder(a: Agent, order: Order): Order {
  // Acknowledge FIRST, before any judgement about whether to comply.
  a.ackFlash = FLASH_SECONDS;
  if (order.type === 'free') {
    a.order = null;
    a.refusing = false;
    a.refusalNote = '';
    log(`${ORDER_LABEL.free} — ${a.name} is on its own judgement again ("${order.said}")`);
    return order;
  }
  a.order = order;
  a.refusing = false;
  a.orderAnswered = false;
  // Compliance is decided next tick, once the order has been weighed against everything else.
  // Only the PARSE is confirmed here, which is the thing that needed confirming.
  log(`heard "${order.said}" -> parsed as ${ORDER_LABEL[order.type]}`);
  return order;
}

/** Point at a place on the planet and tell it to walk there. */
export function orderGoTo(dir: THREE.Vector3, agentId?: string): void {
  const a = agentId ? agents.find((x) => x.id === agentId) : agents.find((x) => x.isPlayer);
  if (!a || !a.alive) return;
  applyOrder(a, {
    type: 'goTo', targetId: null, destination: dir.clone().normalize(),
    said: 'go there', age: 0, standing: false,
  });
}

/** Seconds left in a Kaiju's acknowledgement flash, for the renderers. */
export function ackFlashRemaining(id: string): number {
  const a = id === 'player' ? agents.find((x) => x.isPlayer) : agents.find((x) => x.id === id);
  return a?.ackFlash ?? 0;
}

/**
 * What the command panel needs: the parsed command, how long its flash has left, and whether the
 * Kaiju is actually doing it.
 */
export function playerOrderState(): {
  order: Order | null; label: string; flash: number; refusing: boolean; refusalNote: string;
} {
  const a = agents.find((x) => x.isPlayer);
  return {
    order: a?.order ?? null,
    label: a?.order ? ORDER_LABEL[a.order.type] : '',
    flash: a?.ackFlash ?? 0,
    refusing: !!a?.refusing,
    refusalNote: a?.refusalNote ?? '',
  };
}

/** Human-readable dump for the tracker's copy button. */
export function arenaReport(): string {
  const L: string[] = [];
  L.push(`KAIJU ARENA REPORT  t=${clock.toFixed(1)}s  (Mount Everest ${ARENA_LAT}, ${ARENA_LON})`);
  L.push(`all agents: height ${ARENA_HEIGHT} u = ${ARENA_HEIGHT * METRES_PER_UNIT} m`);
  L.push('');
  for (const a of agents) {
    const p = a.perception;
    L.push(`== ${a.name} [${a.id}]${a.isPlayer ? ' (PLAYER)' : ''} ==`);
    L.push(`   weapon      ${WEAPONS[a.weapon].name} (range ${WEAPONS[a.weapon].rangeBodies} bodies, ` +
           `${WEAPONS[a.weapon].damage} dmg, ${WEAPONS[a.weapon].cooldown}s cd)`);
    L.push(`   stats       ${STAT_NAMES.map((k) => `${k} ${a.build.stats[k]}`).join('  ')}`);
    L.push(`   abilities   ${a.build.abilities.join(', ') || 'none'}   obedience ${a.build.obedience}`);
    L.push(`   health      ${Math.round(a.health)}/${Math.round(a.maxHealth)}`
      + `  (armour cuts ${(a.d.damageReduction * 100).toFixed(0)}% of incoming)`
      + `${a.alive ? '' : `  DEAD (killed by ${a.killedBy})`}`);
    L.push(`   dealt/taken ${Math.round(a.damageDealt)} / ${Math.round(a.damageTaken)}`);
    L.push(`   fired/hit   ${a.shotsFired} attacks, ${a.hitsLanded} connected`);
    L.push(`   action      ${a.action ?? '-'}   tree=${a.lastTreeState}`);
    if (p) {
      L.push(`   PERCEIVES   target=${p.targetId ?? 'none'} dist=${p.targetDistBodies.toFixed(2)} bodies  ` +
             `powerRatio=${p.powerRatio.toFixed(2)}  threats=${p.threatCount}  cover=${p.coverNearby}  ` +
             `sinceHit=${p.timeSinceHit}s`);
    }
    L.push('   SCORES');
    for (const s of a.scores) {
      const cons = s.considerations.map((c) => `${c.name}=${c.input}->${c.score}`).join('  ');
      L.push(`     ${s.action.padEnd(10)} ${s.score.toFixed(3)}   ${cons}`);
    }
    L.push('');
  }
  L.push('EVENTS');
  for (const e of events.slice(-40)) L.push(`  ${e.t.toFixed(1)}s  ${e.text}`);
  return L.join('\n');
}

export function resetArena(playerType: number): void { initArena(playerType); }

export function stopArena(): void { started = false; agents.length = 0; clearProjectiles(); emitArena(); }
