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
  scoreActions, chooseAction, ACTION_TREES, describeChoice,
  type ActionId, type ActionScore, type Perception,
} from './kaijuBrain';

/** Mount Everest. The arena floor is the highest ground on the planet, which is a fine stage. */
export const ARENA_LAT = 27.9881;
export const ARENA_LON = 86.9250;

export const MAX_HEALTH = 1000;
/** All three start identical, per Geoff: same size, same health, different weapons. */
export const ARENA_HEIGHT = 3;      // units = 300 m

export interface Agent {
  id: string;
  name: string;
  /** Monster catalog type, so each is a visually different Kaiju. */
  monsterType: number;
  weapon: WeaponId;
  isPlayer: boolean;
  body: KaijuBody;
  health: number;
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
}

export interface ArenaEvent { t: number; text: string }

const agents: Agent[] = [];
const events: ArenaEvent[] = [];
let clock = 0;
let started = false;
let treeErrorReported = false;

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

function centreOf(a: Agent, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a.body.dir).multiplyScalar(a.body.radius + ARENA_HEIGHT * 0.5);
}
export function feetOf(a: Agent, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(a.body.dir).multiplyScalar(a.body.radius);
}

/** Set up the fight. Player at the centre, the two AI Kaiju waiting a few body-heights away. */
export function initArena(playerType: number): THREE.Vector3 {
  agents.length = 0;
  events.length = 0;
  clearProjectiles();
  clock = 0;
  treeErrorReported = false;

  const d = new Float64Array(3);
  latLonToDirection(ARENA_LAT, ARENA_LON, d);
  const centre = new THREE.Vector3(d[0], d[1], d[2]).normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), centre).normalize();
  const north = new THREE.Vector3().crossVectors(centre, east).normalize();

  // Three corners of a triangle about 6 body-heights across, so they start in sight but not
  // already touching.
  const R = ARENA_HEIGHT * 6;
  const spec: { name: string; type: number; weapon: WeaponId; player: boolean }[] = [
    { name: 'Fort Golem',       type: 17, weapon: 'flame',   player: true  },
    { name: 'Mechanical Golem', type: 16, weapon: 'gun',     player: false },
    { name: 'Elemental Golem',  type: 15, weapon: 'grenade', player: false },
  ];

  spec.forEach((s, i) => {
    const ang = (i / spec.length) * Math.PI * 2;
    const off = east.clone().multiplyScalar(Math.cos(ang) * R).addScaledVector(north, Math.sin(ang) * R);
    const dir = centre.clone().add(off.multiplyScalar(1 / PLANET_RADIUS)).normalize();
    // The player's agent REUSES the shared player body rather than getting its own. That is what
    // makes the walk controller, the third-person camera and the existing HUD drive agent 0 with
    // no extra plumbing, and it means the arena reads exactly the body the player is moving.
    const body = s.player ? playerBody : createKaijuBody();
    // Face the middle, so they are looking at each other when it starts.
    const facing = centre.clone().sub(dir).normalize();
    placeBodyOnSurface(body, dir, facing);
    agents.push({
      id: `k${i}`, name: s.name, monsterType: s.type, weapon: s.weapon, isPlayer: s.player,
      body, health: MAX_HEALTH, alive: true,
      action: null, scores: [], perception: null,
      cooldown: 0, timeSinceHit: 99, timeInAction: 0, damageDealt: 0, damageTaken: 0,
      shotsFired: 0, hitsLanded: 0, killedBy: null,
      tree: null, board: null, treeAction: null, lastTreeState: '-',
      strafeSign: i % 2 === 0 ? 1 : -1, wanderTurn: 0,
    });
  });

  started = true;
  log(`Arena set at Mount Everest. ${agents.map((a) => `${a.name} [${WEAPONS[a.weapon].name}]`).join(' vs ')}`);
  return agents[0].body.dir.clone();
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
    WEAPONS[x.weapon].damage * WEAPONS[x.weapon].count / Math.max(0.05, WEAPONS[x.weapon].cooldown);
  const reach = (x: Agent, distBodies: number) =>
    Math.min(1, WEAPONS[x.weapon].rangeBodies / Math.max(0.5, distBodies));
  const dist = best ? bestD : 999;
  const mine = rawDps(a) * reach(a, dist) * (a.health / MAX_HEALTH);
  const theirs = best ? rawDps(best) * reach(best, dist) * (best.health / MAX_HEALTH) : 0;
  // The same comparison again, but imagining we have already closed to our own effective range.
  const myRange = WEAPONS[a.weapon].rangeBodies;
  const mineClosed = rawDps(a) * (a.health / MAX_HEALTH);
  const theirsClosed = best ? rawDps(best) * reach(best, myRange) * (best.health / MAX_HEALTH) : 0;
  return {
    selfId: a.id,
    healthFrac: a.health / MAX_HEALTH,
    targetId: best?.id ?? null,
    targetDistBodies: best ? bestD : 999,
    powerRatio: mine > 0 ? theirs / mine : 1,
    powerRatioClosed: mineClosed > 0 ? theirsClosed / mineClosed : 1,
    threatCount: threats,
    weaponRangeBodies: WEAPONS[a.weapon].rangeBodies,
    weapon: a.weapon,
    coverNearby: best ? coverBetween(me, centreOf(best, _tmp)) : false,
    timeSinceHit: Math.round(a.timeSinceHit * 10) / 10,
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
  const move = (dirWorld: THREE.Vector3, run: boolean) => {
    reTangentOf(a.body, dirWorld);
    stepBodyOf(a.body, ctx.dt, 1, 0, false, run, ARENA_HEIGHT, dirWorld);
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
      move(_aim, true);
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
      if (Math.random() < ctx.dt * 0.25) a.strafeSign *= -1;
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
    Wander: () => {
      a.wanderTurn += (Math.random() - 0.5) * ctx.dt;
      _aim.copy(a.body.forward);
      _aim.applyAxisAngle(a.body.dir, a.wanderTurn * ctx.dt);
      move(_aim, false);
      return State.SUCCEEDED;
    },
    MeleeAttack: () => {
      if (a.cooldown > 0) return State.FAILED;
      a.cooldown = WEAPONS.melee.cooldown;
      a.shotsFired++;
      const hits = resolveMelee(a.id, centreOf(a, new THREE.Vector3()), a.body.forward, ARENA_HEIGHT, hitTargets());
      applyHits(hits);
      return State.SUCCEEDED;
    },
    FireWeapon: () => {
      if (a.cooldown > 0) return State.FAILED;
      const t = targetOf(a);
      if (!t) return State.FAILED;
      a.cooldown = WEAPONS[a.weapon].cooldown;
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

function applyHits(hits: { targetId: string; ownerId: string; weapon: WeaponId; damage: number }[]): void {
  for (const h of hits) {
    const t = agents.find((a) => a.id === h.targetId);
    const src = agents.find((a) => a.id === h.ownerId);
    if (!t || !t.alive) continue;
    t.health = Math.max(0, t.health - h.damage);
    t.damageTaken += h.damage;
    t.timeSinceHit = 0;
    if (src) { src.damageDealt += h.damage; src.hitsLanded++; }
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

  for (const a of agents) {
    if (!a.alive) continue;
    a.cooldown = Math.max(0, a.cooldown - dt);
    a.timeSinceHit += dt;

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

    if (a.isPlayer && playerControlled) continue;   // AI does not drive the player's body

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

    // Gravity/ground even when the tree did not move it.
    stepBodyOf(a.body, dt, 0, 0, false, false, ARENA_HEIGHT, null);
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
    a.cooldown = WEAPONS.melee.cooldown;
    a.shotsFired++;
    applyHits(resolveMelee(a.id, from, a.body.forward, ARENA_HEIGHT, hitTargets()));
    return;
  }
  a.cooldown = WEAPONS[a.weapon].cooldown;
  a.shotsFired++;
  _aim.copy(a.body.forward).normalize();
  fireWeapon(a.id, a.weapon, from.addScaledVector(a.body.forward, ARENA_HEIGHT * 0.35), _aim, ARENA_HEIGHT);
}

/** Health of the player's Kaiju, for the HUD. */
export function playerAgent(): Agent | null { return agents.find((x) => x.isPlayer) ?? null; }

/** Human-readable dump for the tracker's copy button. */
export function arenaReport(): string {
  const L: string[] = [];
  L.push(`KAIJU ARENA REPORT  t=${clock.toFixed(1)}s  (Mount Everest ${ARENA_LAT}, ${ARENA_LON})`);
  L.push(`all agents: height ${ARENA_HEIGHT} u = ${ARENA_HEIGHT * METRES_PER_UNIT} m, health ${MAX_HEALTH}`);
  L.push('');
  for (const a of agents) {
    const p = a.perception;
    L.push(`== ${a.name} [${a.id}]${a.isPlayer ? ' (PLAYER)' : ''} ==`);
    L.push(`   weapon      ${WEAPONS[a.weapon].name} (range ${WEAPONS[a.weapon].rangeBodies} bodies, ` +
           `${WEAPONS[a.weapon].damage} dmg, ${WEAPONS[a.weapon].cooldown}s cd)`);
    L.push(`   health      ${Math.round(a.health)}/${MAX_HEALTH}${a.alive ? '' : `  DEAD (killed by ${a.killedBy})`}`);
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

export function stopArena(): void { started = false; agents.length = 0; clearProjectiles(); }
