// KaijuCrowd — 200 human beings, 1.8 m tall, milling around a 300 m monster.
//
// Geoff: "It would be good to get a sense of the 300m scale of the Kaiju." That is exactly what
// this is for, and it is the cheapest way to make the size READ. A number in a HUD does not do it;
// a creature whose foot is longer than the crowd running away from it does.
//
// HOW IT IS LIGHT, since that was the requirement.
//
// They are REAL animated characters — the game's own 1.8 m NPC, with its own walk clip — but they
// cost one draw call between them and no per-frame skinning at all.
//
// The trick is in crowdBake.ts: the walk cycle is evaluated ONCE at load and written into a
// texture, so the vertex shader can look up where any vertex is at any point in the cycle. Every
// figure is then just an instance with its own position and its own place in that cycle.
//
//   200 skinned clones : 200 draw calls, 200 skeleton updates every frame
//   this               : 1 draw call, 0 skeleton updates, a few MB of texture
//
// It also scales: a thousand of them would cost the same draw call and the same texture.
//
// Their behaviour is deliberately simple and deliberately human: run for a while, stop and look,
// run again, and generally stay near the monster the way crowds actually do — which is to say some
// flee and some absolutely do not.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useGlobeLook } from '@/features/look/globeLookStore';
import { APP_VERSION } from '@/version';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { body as playerBody } from './kaijuBody';
// THE COSMETIC STREAM. The crowd used to draw from the simulation's own seeded source, which meant
// two hundred people wandering about consumed random numbers the ARENA was going to use — so the
// same battle came out differently depending on whether the crowd happened to be switched on. It
// does no damage and decides nothing, so it has no business touching that sequence.
import { fxRand as rand } from './kaijuRandom';
import { SkeletonUtils } from 'three-stdlib';
import { pickClip } from './kaijuClips';
import { localiseSkinning } from './skinPrecision';
import { buildSoldierTemplate } from './soldierMesh';
import { getAgents, arenaStarted, ARENA_HEIGHT, type Agent } from './kaijuArena';
import {
  chooseTarget, aimPoint, nextShotDelay, nextRetargetDelay, fireBullet, inRange,
  MUZZLE_UP_UNITS, MUZZLE_FWD_UNITS,
} from './kaijuGunfire';
import { maybeShout, updateShoutAnchor } from './kaijuShouts';
import {
  ensureCityColliders, worldToCity, cityToWorld, steerAroundBuildings,
  resolveBuildings, findFreeSpot, isInsideBuilding,
} from './cityColliders';
import { noteGunshot } from './kaijuGunAudio';

/** A real person, in game units. 1.8 m at 100 m per unit. */
const PERSON_UNITS = 1.8 / METRES_PER_UNIT;
/** How many. Geoff asked for 200. */
export const CROWD_SIZE = 200;
/**
 * How far from the Kaiju they spread, in metres.
 *
 * 350, not 900. At 900 m the 200 of them work out to about 79 people per square kilometre — a
 * quiet park, and individually invisible next to something 300 m tall. The point of the crowd is
 * to be a RULER held up against the Kaiju, so they need to be close enough to appear in the same
 * glance. At 350 m the density is roughly 520 per square kilometre and the nearest of them stand
 * about one Kaiju-height away, which is where the comparison actually lands.
 */
const SPREAD_M = 350;
/**
 * A soldier's footprint and how far ahead he looks, in CITY METRES.
 *
 * Both were used throughout the building-avoidance code without ever being declared — seven
 * ReferenceErrors waiting to fire, caught by check:undeclared. 0.45 m is a man's shoulders with a
 * little clearance, and 4 m is about a second of running, which is when a swerve round a wall still
 * looks like a decision rather than a bounce.
 */
const PERSON_RADIUS_M = 0.45;
const LOOKAHEAD_M = 4;
/**
 * Beyond this, a figure is detached from the scene graph entirely. In game units.
 *
 * THIS CONSTANT DID NOT EXIST. It was used twice, a hundred lines below, and never declared — so
 * every frame the crowd's loop threw `ReferenceError: CULL_UNITS is not defined` out of the
 * animation callback, which kills react-three-fiber's ENTIRE loop. Not just the crowd: the camera
 * stopped, the Kaiju stopped, the terrain stopped. Geoff: "I can't move and the camera doesn't
 * move... much of the terrain seems to not be rendering. But I can hear the footsteps."
 *
 * The footsteps are the tell — audio is scheduled ahead of time and keeps playing after the frame
 * loop dies, so the fight was still running while nothing at all was being drawn or moved.
 *
 * 2 km, chosen conservatively because the value it replaces is unknown: the crowd spawns within
 * 350 m and the scale shot puts the camera 500 m back, so nothing that should be visible is ever
 * culled, and figures still detach once you fly away from them.
 */
const CULL_UNITS = 2000 / METRES_PER_UNIT;
/** Running speed, metres per second. A frightened human, not an athlete. */
const RUN_MS = 5.5;   // a running human, not an athlete
/**
 * Ground covered by ONE full walk cycle, as a fraction of height.
 *
 * 1.4, not 0.8. At 0.8 a cycle covers 1.44 m, which at a 5.5 m/s run is 3.8 cycles a second —
 * nearly twice a real runner's 2.2, and the same "why are they moving so fast" that the previous
 * procedural version had. A running human covers about 2.5 m per cycle, which is 1.4 x 1.8 m.
 */
const STRIDE_FRAC = 1.4;

/**
 * A REAL SOLDIER, not a 1.8 m demon.
 *
 * Geoff: "they seem to be based on the red demon model because they have identical colors... Look
 * instead through all the Synty/polygon sets of models for one that says soldier or army."
 *
 * They were: the crowd used the game's own 1.8 m Demon Horde NPC, which was never the cause of the
 * shattering but was certainly the wrong thing to be looking at. This one carries a rifle and ships
 * with Walk, Run, Run_Shoot, Gun_Shoot, Idle_Gun and Death.
 */
const SOLDIER_URL = '/siege/characters/soldier.glb';
/** The rifle. Four flat-coloured pieces, no textures, so it merges into the man carrying it. */
const RIFLE_URL = '/siege/weapons/ak47.glb';

interface Person {
  /** Unit direction from the planet centre. */
  dir: THREE.Vector3;
  /** Tangent heading. */
  fwd: THREE.Vector3;
  running: boolean;
  /** Seconds until the next stop/start decision. */
  timer: number;
  /** Where this person is in the walk cycle, 0..1. Advanced by distance covered, not by time. */
  phase: number;
  speed: number;
  /**
   * Which Kaiju this individual has decided to follow and shoot at.
   *
   * Per PERSON, not per crowd. Geoff: "Each human should decide which Kaiju to follow and shoot at."
   * That one word is what separates an army from a flock — with a shared target the whole crowd
   * turns as one body every time a different Kaiju gets closer, which looks nothing like people.
   */
  targetId: string | null;
  /** Seconds until this person's next shot. */
  fireIn: number;
  /**
   * Seconds until this person reconsiders who they are shooting at.
   *
   * Geoff: "maybe it re-rolls every 10 seconds and then the closer the kaiju, the more likely they
   * will choose it. So if a kaiju walks closer, it will start drawing fire, and the closer it gets,
   * the more soldiers fire at it."
   *
   * Ten seconds is slow enough that an individual reads as having committed to a target, and fast
   * enough that a Kaiju walking into the crowd visibly pulls fire onto itself within a few seconds.
   */
  retargetIn: number;
  /**
   * Seconds left on this person's firing animation.
   *
   * Only used when STANDING: the running clip is Run_Shoot, which already shows him firing on the
   * move, so overriding it would replace a good animation with a worse one.
   */
  shootFor: number;
  /**
   * Which way this soldier committed to going round the building in front of him, -1 or 1.
   *
   * Committing matters: recomputing the side every frame makes a man shudder against a wall as the
   * two choices trade places. Zero means nothing is in the way.
   */
  side: number;
  /** Frames spent stuck inside geometry, so a soldier wedged in a wall can be teleported clear. */
  stuck: number;
}

let crowdOn = false;
/**
 * Bumped whenever the crowd should re-form somewhere new.
 *
 * Without this, `setCrowd(true)` on an already-visible crowd did nothing, so jumping from Everest
 * to the Grand Canyon left 200 people standing on the wrong mountain — they spawn around the Kaiju
 * ONCE, when the component mounts. The epoch is a React key, so a new site rebuilds them.
 */
let crowdEpoch = 0;

/**
 * Where to put the crowd. Null = a ring around the Kaiju, the default.
 *
 * The scale view needs them strung out in the CORRIDOR between the viewer and the Kaiju instead,
 * because that is what makes the comparison work: people at your feet, people in the middle
 * distance, and the creature beyond them all — three reference points in one line of sight, which
 * is far more legible than a ring you are standing outside of.
 */
let spawnHint: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
export function setCrowdCorridor(from: THREE.Vector3 | null, to?: THREE.Vector3): void {
  spawnHint = from && to ? { from: from.clone().normalize(), to: to.clone().normalize() } : null;
}
const listeners = new Set<() => void>();
export function isCrowdOn(): boolean { return crowdOn; }

/** Live state, so 'I don't see the humans' can be answered by looking rather than guessing. */
export const crowdDiag = { on: false, spawned: 0, layout: 'none' as 'none' | 'ring' | 'corridor', modelOk: false, scale: 0 };
export function subscribeCrowd(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
/** Turn the crowd on explicitly — used when a battle starts, so they are simply there. */
export function setCrowd(on: boolean): void {
  // Always re-form on a fresh request, even if already visible — that is the point.
  if (on) crowdEpoch++;
  if (crowdOn === on) { for (const l of listeners) l(); return; }
  crowdOn = on;
  for (const l of listeners) l();
}

export function toggleCrowd(): void {
  crowdOn = !crowdOn;
  if (crowdOn) crowdEpoch++;
  for (const l of listeners) l();
  console.log(`[kaiju] crowd ${crowdOn ? 'ON' : 'OFF'} — ${CROWD_SIZE} people at 1.8 m`);
}

export function KaijuCrowd() {
  const [, force] = useState(0);
  useEffect(() => subscribeCrowd(() => force((n) => n + 1)), []);
  if (!crowdOn) return null;
  // Keyed by epoch: a new battle site rebuilds the crowd around the Kaiju's new position.
  return <Crowd key={crowdEpoch} />;
}

/**
 * Where everyone starts.
 *
 * CORRIDOR (the scale view): strung along the line from the viewer to the Kaiju, so there are
 * figures near, in the middle distance, and far — three legible reference depths in one line of
 * sight, which is what makes the size comparison work.
 *
 * RING (everywhere else): scattered around the Kaiju itself.
 */
function makePeople(): Person[] {
  const out: Person[] = [];
  // Whether there is a city to avoid. Checked once for the whole spawn rather than per person.
  const inCity = ensureCityColliders();

  if (spawnHint) {
    const { from, to } = spawnHint;
    const side = new THREE.Vector3().crossVectors(from, to).normalize();
    for (let i = 0; i < CROWD_SIZE; i++) {
      // Biased toward the near end, so the closest figures — the readable ones — are the many.
      const t = 0.06 + Math.pow(rand(), 1.5) * 0.82;
      const dir = from.clone().lerp(to, t).normalize();
      // Lateral scatter widens down the corridor, which reads as depth rather than as a queue.
      const spread = (60 + t * 420) / METRES_PER_UNIT;
      dir.addScaledVector(side, ((rand() * 2 - 1) * spread) / PLANET_RADIUS).normalize();
      const fwd = new THREE.Vector3().crossVectors(dir, side).normalize();
      out.push({
        dir, fwd, running: rand() < 0.65, timer: rand() * 3, phase: rand(),
        speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
        targetId: chooseTarget(dir),
        // Stagger the OPENING shots across the whole 1-10 second window, or two hundred rifles go
        // off within a tenth of a second of each other the instant the crowd appears.
        fireIn: nextShotDelay(),
        retargetIn: nextRetargetDelay(),
        shootFor: 0,
        side: 0,
        stuck: 0,
      });
    }
    return out;
  }

  const centre = playerBody.dir.clone().normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), centre).normalize();
  const north = new THREE.Vector3().crossVectors(centre, east).normalize();
  for (let i = 0; i < CROWD_SIZE; i++) {
    // sqrt on the radius gives even area density instead of everyone bunched in the middle.
    const r = Math.sqrt(rand()) * (SPREAD_M / METRES_PER_UNIT);
    const ang = rand() * Math.PI * 2;
    const dir = centre.clone()
      .addScaledVector(east, (Math.cos(ang) * r) / PLANET_RADIUS)
      .addScaledVector(north, (Math.sin(ang) * r) / PLANET_RADIUS)
      .normalize();
    out.push({
      dir,
      fwd: new THREE.Vector3().crossVectors(dir, east).normalize(),
      running: rand() < 0.7,
      timer: rand() * 3,
      phase: rand(),
      speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
      targetId: chooseTarget(dir),
      fireIn: nextShotDelay(),
      retargetIn: nextRetargetDelay(),
      shootFor: 0,
      side: 0,
      stuck: 0,
    });
  }
  // NOBODY STARTS INSIDE A BUILDING.
  //
  // The ring and the corridor are laid out around the Kaiju with no idea the city is there, so in
  // Dubai a good third of them land in a tower. Pushing out does not solve it — the footprints abut,
  // so out of one wall is into the next — which is what findFreeSpot's spiral search is for. Done
  // once, here, rather than left to the per-frame rescue: two hundred men teleporting out of walls
  // over the first few seconds is a worse first impression than a moment's work at spawn.
  if (inCity) {
    const p = new THREE.Vector3();
    const fix = { x: 0, z: 0 };
    let moved = 0;
    for (const person of out) {
      p.copy(person.dir).multiplyScalar(playerBody.radius);
      if (!worldToCity(p, p)) break;
      if (!isInsideBuilding(p.x, 1, p.z, PERSON_RADIUS_M)) continue;
      if (!findFreeSpot(p.x, p.z, PERSON_RADIUS_M, fix)) continue;
      p.set(fix.x, p.y, fix.z);
      cityToWorld(p, p);
      person.dir.copy(p).normalize();
      moved++;
    }
    if (moved) console.log(`[crowd] moved ${moved} soldiers out of buildings at spawn`);
  }

  return out;
}

function Crowd() {
  // REAL NPCs, RENDERED THE WAY EVERY OTHER NPC IN THIS GAME IS RENDERED.
  //
  // Geoff: "the 1.8m humans look like sparkling random geometric shapes, they don't seem to have a
  // mesh or be based on our NPCs. Why don't they? The game has so many NPCs all working perfectly,
  // so how can it be a challenge to add them here?"
  //
  // He is right, and the answer is that I did not use them. I wrote a Vertex Animation Texture
  // instead — bake the walk cycle into a float texture, draw all 200 as one instanced call with a
  // custom vertex shader. On paper that is far cheaper: 1 draw call and no skinning. In practice my
  // shader was wrong, and a wrong VAT does not look slightly off, it looks like confetti — which is
  // exactly "sparkling random geometric shapes".
  //
  // The model was never the problem: it is already the game's own 1.8 m Demon Horde NPC. So this
  // now uses the SAME recipe as GlobeKaiju and AgentAvatar, which demonstrably work:
  // SkeletonUtils.clone plus an AnimationMixer per figure. Boring, proven, and visible.
  //
  // COST, honestly: 200 skinned characters is 200 draw calls and 200 skeleton updates, where the
  // VAT would have been one and none. Mitigated by updating each figure's mixer on a stagger (a
  // third of them per frame, with three times the delta), which is the standard trick and cuts the
  // skinning cost to a third without anyone being able to see the difference at 1.8 m. If it turns
  // out too heavy, the answer is fewer people or a fixed VAT — not a broken one.
  const { scene, animations } = useGLTF(`${SOLDIER_URL}?v=${APP_VERSION}`);
  // The weapon is a SEPARATE file: this soldier's clips were authored around a rifle that is not in
  // his model. Merged into his geometry below, so it still costs one draw call between them.
  const { scene: rifleScene } = useGLTF(`${RIFLE_URL}?v=${APP_VERSION}`);
  const group = useRef<THREE.Group>(null);
  const people = useMemo<Person[]>(() => makePeople(), []);

  /**
   * The merged, one-draw-call rifleman, built once and cloned per figure.
   *
   * Falls back to the raw glTF if the merge is refused — slower (eleven draws a man instead of one)
   * but correct, which is the right way round for a fallback.
   */
  const template = useMemo(
    () => buildSoldierTemplate(scene, animations, rifleScene),
    [scene, animations, rifleScene],
  );

  /** One clone + mixer per figure. Built once; the frame loop only moves them. */
  const figures = useMemo(() => {
    const source = template?.root ?? (scene as THREE.Group);
    const modelHeight = template?.height ?? 1.8;
    const scale = PERSON_UNITS / Math.max(1e-4, modelHeight);

    // TWO CLIPS, because a soldier advancing with a rifle up and a soldier standing still are
    // different pictures and this model ships both. Resolved through the shared picker rather than
    // by exact name, so a future model with different clip names still gets something sensible
    // instead of nothing — the failure mode that leaves a figure frozen in its bind pose.
    const info = animations.map((a) => ({ name: a.name, duration: a.duration }));
    const byName = (n: string | null) => (n ? animations.find((a) => a.name === n) ?? null : null);
    const moveClip = byName(pickClip(info, ['run_shoot', 'run', 'jog', 'walk']));
    const idleClip = byName(pickClip(info, ['idle_gun', 'idle', 'breathidle']));
    // A THIRD clip: standing and firing. Without it a stationary soldier's rifle flashes while he
    // holds a completely still pose, which reads as the flash belonging to something else.
    const shootClip = byName(pickClip(info, ['idle_gun_shoot', 'gun_shoot', 'shoot']));
    const clip = moveClip ?? idleClip;

    const out: {
      obj: THREE.Group; mixer: THREE.AnimationMixer;
      action: THREE.AnimationAction | null; idle: THREE.AnimationAction | null;
      shoot: THREE.AnimationAction | null;
      /** Whether this figure is currently in the scene graph at all. */
      attached: boolean;
    }[] = [];
    let localised = 0;
    for (let i = 0; i < CROWD_SIZE; i++) {
      const obj = SkeletonUtils.clone(source) as THREE.Group;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // SOLDIERS NEVER CAST, on purpose. Geoff: "turn on shadows for kaiju but not soldiers."
        // Right twice over: at 1.8 m against a multi-kilometre shadow map a man's shadow is about
        // one texel, so it would be a smear rather than a silhouette — and two hundred extra shadow
        // casters is the single most expensive thing that could be added to this scene, for
        // something nobody can resolve. They do RECEIVE, so the Kaiju's shadow sweeps over the
        // crowd as it moves, which is the shot that actually matters.
        m.castShadow = false;
        m.receiveShadow = false;   // owned by the effect below, which reacts to the panel
        // FRUSTUM CULLING BACK ON, with a bounding sphere it can trust.
        //
        // It was off, so all two hundred figures were skinned and drawn every frame even when they
        // were behind the camera. It will have been turned off because a SkinnedMesh's bounding
        // sphere comes from the BIND pose and can be wrong once the model is posed — which makes
        // figures pop out of existence. Inflating the sphere fixes that properly, rather than paying
        // for every figure whether or not it is on screen.
        m.frustumCulled = true;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        if (m.geometry.boundingSphere) m.geometry.boundingSphere.radius *= 2.2;
      });
      // THE WHOLE REASON THE CROWD WORKS AT ALL. Without this every vertex of every soldier picks up
      // a third of a metre of noise from being six thousand kilometres out from the world origin —
      // 21% of his own height, re-rolled every frame. See skinPrecision.ts.
      localised += localiseSkinning(obj);
      obj.scale.setScalar(scale);

      const mixer = new THREE.AnimationMixer(obj);
      let action: THREE.AnimationAction | null = null;
      let idle: THREE.AnimationAction | null = null;
      if (moveClip) {
        action = mixer.clipAction(moveClip);
        // Start each figure at a different point in the cycle, or two hundred people march in step.
        action.time = rand() * moveClip.duration;
        action.play();
      }
      if (idleClip && idleClip !== moveClip) {
        idle = mixer.clipAction(idleClip);
        idle.time = rand() * idleClip.duration;
        idle.play();
        idle.setEffectiveWeight(0);
      }
      let shoot: THREE.AnimationAction | null = null;
      if (shootClip && shootClip !== moveClip && shootClip !== idleClip) {
        shoot = mixer.clipAction(shootClip);
        shoot.play();
        shoot.setEffectiveWeight(0);
      }
      out.push({ obj, mixer, action, idle, shoot, attached: true });
    }
    crowdDiag.modelOk = out.length > 0 && clip != null;
    crowdDiag.scale = scale;
    console.log(`[crowd] ${out.length} soldiers from ${SOLDIER_URL} | clip "${clip?.name ?? 'none'}"`
      + ` | move "${moveClip?.name ?? 'none'}" idle "${idleClip?.name ?? 'none'}" shoot "${shootClip?.name ?? 'none'}"`
      + ` | model height ${modelHeight.toFixed(3)} -> scale ${scale.toFixed(5)}`
      + ` | merged ${template ? 'YES (1 draw each)' : 'NO (fallback)'}`
      + ` | rifle ${template?.hasRifle ? 'attached' : 'MISSING'}`
      + ` | skinning localised on ${localised} meshes`);
    return out;
  }, [scene, animations, template]);

  // Attach the clones once, and take them down cleanly.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const f of figures) { g.add(f.obj); f.attached = true; }
    crowdDiag.on = true;
    crowdDiag.spawned = people.length;
    crowdDiag.layout = spawnHint ? 'corridor' : 'ring';
    return () => {
      for (const f of figures) { f.mixer.stopAllAction(); g.remove(f.obj); f.attached = false; }
      crowdDiag.on = false;
      crowdDiag.spawned = 0;
    };
  }, [figures, people]);

  const camera = useThree((st) => st.camera);
  /**
   * The Kaiju's shadow sweeping over the crowd is the shot that makes the scale land, so the
   * soldiers RECEIVE — they just never cast. Reactive, because the flags used to be set when each
   * figure was cloned and the panel is opened long after that.
   */
  const look = useGlobeLook();
  const receive = look.enabled && look.shadowsOn;
  useEffect(() => {
    for (const f of figures) {
      f.obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.receiveShadow = receive; });
    }
  }, [figures, receive]);

  const _up = useMemo(() => new THREE.Vector3(), []);
  const _side = useMemo(() => new THREE.Vector3(), []);
  const _axis = useMemo(() => new THREE.Vector3(), []);
  const _toKaiju = useMemo(() => new THREE.Vector3(), []);
  const _basis = useMemo(() => new THREE.Matrix4(), []);
  // Scratch for the city frame. Allocated once: this runs two hundred times a frame.
  const _cityPos = useMemo(() => new THREE.Vector3(), []);
  const _cityAhead = useMemo(() => new THREE.Vector3(), []);
  const _steer = useMemo(() => ({ x: 0, z: 0, side: 0 }), []);
  const _fix = useMemo(() => ({ x: 0, z: 0 }), []);
  const _muzzle = useMemo(() => new THREE.Vector3(), []);
  const _aim = useMemo(() => new THREE.Vector3(), []);
  const frame = useRef(0);

  useFrame((_, rawDt) => {
    if (!group.current) return;
    const dt = Math.min(rawDt, 0.05);
    frame.current++;
    const STAGGER = 3;
    // One check for the whole crowd, not one per soldier.
    const cityReady = ensureCityColliders();
    // ONE radius for the whole crowd's city maths. The city is flat and level in its own frame, so
    // the exact altitude a given soldier stands at moves his position in that frame by centimetres —
    // far less than his own width, and not worth a terrain sample per person per frame just to get
    // a number that is only used to work out which building he is next to.
    const groundRadius = playerBody.radius;
    // Look the roster up ONCE per frame, not once per person: getAgents returns the live array and
    // two hundred linear searches a frame for the same four entries is two hundred too many.
    const fighting = arenaStarted();
    const byId = new Map<string, Agent>();
    if (fighting) for (const a of getAgents()) byId.set(a.id, a);

    for (let i = 0; i < people.length && i < figures.length; i++) {
      const p = people[i];
      const f = figures[i];

      // WHO THIS PERSON IS AFTER. Their own choice, kept until it dies. With no fight running they
      // fall back to the player's body exactly as they did before, so the plain scale shot — a
      // crowd and one Kaiju, no battle — is unchanged.
      let target = p.targetId ? byId.get(p.targetId) : undefined;
      // Reconsider on a timer, and immediately if the one they were shooting at has fallen. The
      // draw is weighted by distance, so this is what makes an approaching Kaiju pull fire.
      p.retargetIn -= dt;
      if (fighting && (p.retargetIn <= 0 || !target || !target.alive)) {
        p.retargetIn = nextRetargetDelay();
        p.targetId = chooseTarget(p.dir);
        target = p.targetId ? byId.get(p.targetId) : undefined;
      }
      const kaiju = target?.body.dir ?? playerBody.dir;

      p.timer -= dt;
      if (p.timer <= 0) {
        p.running = !p.running;
        p.timer = p.running ? 2.5 + rand() * 5 : 0.4 + rand() * 1.4;
        if (p.running) {
          _toKaiju.copy(kaiju).sub(p.dir);
          _toKaiju.addScaledVector(p.dir, -_toKaiju.dot(p.dir));
          if (_toKaiju.lengthSq() < 1e-12) _toKaiju.copy(p.fwd);
          _toKaiju.normalize();
          _axis.copy(p.dir);
          // STANDOFF. Inside about one body height they stop closing and work sideways instead.
          //
          // Two reasons, and the second is the one that matters. Infantry do not walk up and hug
          // something 300 m tall. And a soldier who closes all the way is a soldier whose chosen
          // target is permanently the nearest thing to him — so he never reconsiders, which is
          // exactly Geoff's "once they shoot at another Kaiju they never switch back". Keeping a
          // distance is what leaves room for a second Kaiju to become the closer one.
          const gap = p.dir.angleTo(kaiju) * PLANET_RADIUS;
          const turn = gap < ARENA_HEIGHT ? Math.PI * 0.5 + (rand() - 0.5) * 1.2 : (rand() - 0.5) * 1.5;
          p.fwd.copy(_toKaiju).applyAxisAngle(_axis, turn).normalize();
        }
      }

      if (p.running) {
        // AVOID THE BUILDINGS BEFORE MOVING, not after.
        //
        // The steering happens in the city's own flat frame — metres from the city origin, where the
        // ground is level and the maths is two-dimensional — and the result is folded back into the
        // heading before the sphere step uses it. Doing it the other way round, as a correction
        // applied after the move, is what makes a crowd visibly stutter against walls.
        if (cityReady) {
          _cityPos.copy(p.dir).multiplyScalar(groundRadius);
          if (worldToCity(_cityPos, _cityPos)) {
            // The heading, expressed in the same flat frame: two points a metre apart along it.
            _cityAhead.copy(p.dir).multiplyScalar(groundRadius).addScaledVector(p.fwd, 0.01);
            if (worldToCity(_cityAhead, _cityAhead)) {
              const hx = _cityAhead.x - _cityPos.x, hz = _cityAhead.z - _cityPos.z;
              const hl = Math.hypot(hx, hz);
              if (hl > 1e-6) {
                _steer.side = p.side;
                const deflected = steerAroundBuildings(
                  _cityPos.x, _cityPos.z, hx / hl, hz / hl, PERSON_RADIUS_M, LOOKAHEAD_M, _steer,
                );
                p.side = deflected ? _steer.side : 0;
                if (deflected) {
                  // Back to a world heading: step a metre along the new flat direction and take the
                  // difference. Cheaper and safer than rotating the quaternion by hand, and it
                  // cannot get the frame's handedness wrong.
                  _cityAhead.set(_cityPos.x + _steer.x, _cityPos.y, _cityPos.z + _steer.z);
                  cityToWorld(_cityAhead, _cityAhead);
                  cityToWorld(_cityPos, _cityPos);
                  p.fwd.copy(_cityAhead).sub(_cityPos);
                  p.fwd.addScaledVector(p.dir, -p.fwd.dot(p.dir));
                  if (p.fwd.lengthSq() > 1e-12) p.fwd.normalize();
                }
              }
            }
          }
        }

        const dist = p.speed * dt;
        _axis.crossVectors(p.dir, p.fwd).normalize();
        const ang = dist / PLANET_RADIUS;
        p.dir.applyAxisAngle(_axis, ang).normalize();
        p.fwd.applyAxisAngle(_axis, ang);
        p.fwd.addScaledVector(p.dir, -p.fwd.dot(p.dir)).normalize();
      }

      // ...and the last resort, AFTER the move: anyone who has ended up in a wall is pushed out of
      // it. Someone who cannot be pushed out — Dubai's footprints abut, so half the time there is no
      // daylight to push into — is teleported to open ground after a second of being stuck, which is
      // ugly once and better than a soldier standing inside a tower for the rest of the battle.
      if (cityReady) {
        _cityPos.copy(p.dir).multiplyScalar(groundRadius);
        if (worldToCity(_cityPos, _cityPos)) {
          if (resolveBuildings(_cityPos.x, _cityPos.z, PERSON_RADIUS_M, _fix)) {
            p.stuck = isInsideBuilding(_fix.x, 1, _fix.z, PERSON_RADIUS_M) ? p.stuck + 1 : 0;
            if (p.stuck > 60) { findFreeSpot(_fix.x, _fix.z, PERSON_RADIUS_M, _fix); p.stuck = 0; }
            _cityAhead.set(_fix.x, _cityPos.y, _fix.z);
            cityToWorld(_cityAhead, _cityAhead);
            p.dir.copy(_cityAhead).normalize();
          } else p.stuck = 0;
        }
      }

      // DISTANCE CULL, and it is the biggest single saving available here.
      //
      // A 1.8 m figure a kilometre and a half away is under a pixel. Skinning it and handing it to
      // the GPU is pure cost — and hiding it also stops three.js walking its sixty-odd bones, which
      // is most of the win: two hundred figures is over twelve thousand objects whose matrices are
      // otherwise recomputed every single frame whether or not anyone can see them.
      //
      // The position is from LAST frame, which is correct: a person moves five metres a second and
      // the threshold is fifteen hundred.
      // OUT OF THE SCENE GRAPH ENTIRELY, not merely invisible.
      //
      // `visible = false` stops a figure being DRAWN and nothing else: three.js still walks it and
      // every one of its bones in updateMatrixWorld, every frame, because that traversal does not
      // look at visibility. Two hundred figures is over twelve thousand objects whose matrices were
      // being composed and multiplied sixty times a second whether or not anyone could see them, and
      // that traversal is most of what a crowd of skinned characters actually costs.
      //
      // Detaching is the only thing that skips it. Re-attached the moment it comes back in range.
      const tooFar = f.obj.position.distanceToSquared(camera.position) > CULL_UNITS * CULL_UNITS;
      if (tooFar) {
        if (f.attached) { group.current.remove(f.obj); f.attached = false; }
        continue;
      }
      if (!f.attached) { group.current.add(f.obj); f.attached = true; }

      // STAGGERED SKINNING. Each figure's mixer advances every third frame with three frames'
      // worth of time, so the animation runs at the right speed for a third of the cost. At 1.8 m
      // against a 300 m Kaiju nobody can see the difference.
      if (p.shootFor > 0) p.shootFor -= dt;
      if ((i % STAGGER) === (frame.current % STAGGER)) {
        // THREE STATES: advancing, standing, and standing-while-firing. Instant weight swaps rather
        // than crossfades — with the mixer only ticking every third frame a fade would stutter, and
        // at 1.8 m against a 300 m monster the pop is invisible.
        //
        // Firing only overrides STANDING. The running clip is already Run_Shoot, which shows him
        // firing on the move, so cutting to a stationary shoot pose mid-stride would be a downgrade.
        const shootNow = p.shootFor > 0 && !p.running && f.shoot != null;
        if (f.action) f.action.setEffectiveWeight(p.running ? 1 : 0);
        if (f.idle) f.idle.setEffectiveWeight(!p.running && !shootNow ? 1 : 0);
        if (f.shoot) f.shoot.setEffectiveWeight(shootNow ? 1 : 0);
        // Everything ticks, always. Weighting an action to zero does not stop it, and a stopped
        // soldier whose idle is not advancing freezes mid-stride.
        f.mixer.update(dt * STAGGER);
      }

      // NEVER FALL BACK TO SEA LEVEL: on the canyon rim that is 2.1 km underground, which is why
      // the crowd was once invisible. The Kaiju's own radius is always valid and is the same ground.
      const metres = sampleGlobeSurface(p.dir.x, p.dir.y, p.dir.z);
      const radius = metres != null
        ? PLANET_RADIUS + metres / METRES_PER_UNIT
        : playerBody.radius;
      f.obj.position.copy(p.dir).multiplyScalar(radius);
      _up.copy(p.dir);
      _side.crossVectors(_up, p.fwd).normalize();
      _basis.makeBasis(_side, _up, p.fwd);
      f.obj.quaternion.setFromRotationMatrix(_basis);

      // PULL THE TRIGGER.
      //
      // Fired straight from the crowd loop rather than from a system of its own, because the shot
      // needs the position and heading THIS person has right now — and those exist here and nowhere
      // else. A separate shooting system would have to keep its own copy of where everybody is,
      // which is how two sources of truth start.
      //
      // The rifle points where the person is facing, not at the Kaiju: someone running for their
      // life and firing over their shoulder is the shot. Aim only decides where the BULLET goes.
      p.fireIn -= dt;
      _muzzle.copy(f.obj.position)
        .addScaledVector(p.dir, MUZZLE_UP_UNITS)
        .addScaledVector(p.fwd, MUZZLE_FWD_UNITS);
      // HOLD FIRE IF IT IS OUT OF REACH. The range comes from the round's own drag curve, so a
      // soldier will not empty a magazine at something a bullet could never arrive at.
      if (p.fireIn <= 0 && target && inRange(p.dir, target)) {
        p.fireIn = nextShotDelay();
        fireBullet(_muzzle, aimPoint(target, _aim));
        // Offered, not played. The audio layer decides what is worth a voice once it can see all of
        // this frame's shots at once — see kaijuGunAudio.
        noteGunshot(_muzzle);
        // Play the firing animation from its first frame, so the recoil starts with the flash.
        if (f.shoot && !p.running) {
          p.shootFor = f.shoot.getClip().duration;
          f.shoot.reset().play();
        }
        // ...and one shot in fifty, say something about it. The odds live in kaijuShouts with the
        // lines; `i` identifies the speaker so the bubble can follow them.
        maybeShout(_muzzle, i);
      }
      // A bubble belongs to a PERSON, not to a spot on the ground. Keeping it over their head means
      // the tail still points at them a second later, when they have run fifty metres.
      updateShoutAnchor(i, _muzzle);
    }
  });

  return <group ref={group} />;
}
