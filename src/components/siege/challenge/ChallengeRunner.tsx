// ChallengeRunner — plays a Challenge (Phase 1). Lives inside the Canvas: it spawns each wave's
// monster drops, runs the wave timer, ends a wave EARLY when every monster it spawned is dead,
// and CARRIES unkilled monsters into the next wave (whose announcement then shows faint + brief).
// It writes wave/timer/announcement state to challengeStore for the DOM HUD to render.
//
// Start/stop the built-in test challenge with Cmd/Ctrl+Shift+C (Cmd+W closes the browser tab).
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CatalogMonster, makeHordeMember, type MType, type Ov, type MonsterMods } from '../siegeMonsterCatalog';
import { siegeDemons, setSiegeScoreHook } from '../siegeHorde';
import { sampleHeight } from '../terrainHeight';
import { groundAt } from '../siegeGround';
import { raycastMesh, meshGroundHeight } from '../meshColliderSystem';
import * as THREE from 'three';
import { setChallengeState } from './challengeStore';
import { setChallengeToggle, setChallengeLose, setChallengeStart, setChallengeSkip, fireChallengeRevive } from './challengeControl';
import { setSiegePlayerDead } from '../siegePlayerState';
import { resetChallengeScore, addChallengeScore, getChallengeScore } from './challengeScore';
import { recordChallengeRun } from './challengeStorage';
import { TEST_CHALLENGE } from './testChallenge';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveGame } from '@/config/activeGame';
import { getActiveMapId, useActiveMapId } from '@/config/activeMap';
import { challengeWorldArrival } from '../siegeAreas';
import type { Challenge, MonsterDrop, ColorMods } from './challengeTypes';

interface Spawned { id: string; type: MType; spawn: [number, number, number]; ov?: Ov; mods?: MonsterMods; color?: ColorMods; rise: boolean; }

// Deterministic pseudo-random in [0,1) from an integer seed (so spawn spots are the SAME every
// play and the player can learn them).
const hashRnd = (n: number) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453123; return s - Math.floor(s); };
// A seeded point on a uniform disk of `radius` around (cx,cz).
function seededPoint(cx: number, cz: number, radius: number, seed: number): [number, number] {
  const ang = hashRnd(seed * 1.7 + 0.3) * Math.PI * 2;
  const rr = Math.sqrt(hashRnd(seed * 2.9 + 5.1)) * radius;
  return [cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr];
}

export function ChallengeRunner() {
  const camera = useThree((s) => s.camera);
  const { user } = useAuth();
  const [mobs, setMobs] = useState<Spawned[]>([]);
  const challengeRef = useRef<Challenge | null>(null);
  const groundSnap = useRef<{ until: number; ceil: number; holdY: number } | null>(null);   // drop the player onto the street once its BVH loads
  const prePos = useRef<THREE.Vector3 | null>(null);   // where the player was before the challenge
  const preMap = useRef<string | null>(null);          // which map, so we can jump back on finish
  const r = useRef({
    active: false, runId: 0, waveIdx: 0, waveEndsAt: 0, startedAt: 0, countdownUntil: 0,
    pending: [] as { drop: MonsterDrop; at: number; seed: number; spread: boolean }[], dropsDone: false, sawAlive: false,
    faintNext: false, idc: 0,
  }).current;

  // Leaving the arena (Cmd-J / teleport to another world) must END the challenge and clear its mobs —
  // otherwise they keep chasing the camera into the new world AND new waves keep spawning there.
  const mapId = useActiveMapId();
  useEffect(() => {
    const ch = challengeRef.current;
    const arenaMap = ch?.mapId || preMap.current || '';
    if (r.active && mapId !== arenaMap) {
      r.active = false; r.countdownUntil = 0; r.pending = [];
      setMobs([]);
      setChallengeState({ active: false, completed: false, announce: null, wave: 0, waveEndsAt: 0, countdownUntil: 0, result: null });
    } else if (!r.active) {
      setMobs([]);   // clear any leftover mobs on a map change when no challenge is running
    }
  }, [mapId, r]);

  const buildMobs = (drop: MonsterDrop, _seed: number, _spread: boolean): Spawned[] => {
    // SPECIAL set piece: not a monster spawn. Phase 2 will invoke its hard-coded behaviour (keyed by
    // drop.special.code); for now it spawns nothing (a safe no-op) so it never drops a stray monster.
    if (drop.special) return [];
    const out: Spawned[] = [];
    const ch = challengeRef.current!;
    const mods: MonsterMods | undefined = drop.boss
      ? { sizeMul: drop.boss.sizePct / 100, speedMul: drop.boss.speedPct / 100, healthMul: drop.boss.healthPct / 100, damageMul: drop.boss.damagePct / 100 }
      : undefined;

    // Arena centre (legacy default / fallback) — the baked arrival or the authored spawn, anchored to
    // the REAL mesh ground there (eye-height spawn Y can sit above the floor on an elevated arena).
    const arr = ch.mapId ? challengeWorldArrival(ch.mapId) : null;
    const ax = arr?.pos[0] ?? ch.spawn?.[0] ?? drop.x;
    const ayRaw = arr?.pos[1] ?? ch.spawn?.[1] ?? 26;
    const az = arr?.pos[2] ?? ch.spawn?.[2] ?? drop.z;
    const arenaY = groundAt(ax, az, ayRaw + 8) ?? sampleHeight(ax, az) ?? ayRaw;

    // PATTERN CENTRE. random/grid/circle surround the PLAYER's live position when the spawn fires;
    // coords uses the authored world point; legacy (no pattern) uses the arena centre.
    const mode = drop.pattern?.mode;
    const playerCentred = mode === 'random' || mode === 'grid' || mode === 'circle';
    let cx0 = ax, cz0 = az, cy0 = arenaY;
    if (playerCentred) {
      cx0 = camera.position.x; cz0 = camera.position.z;
      cy0 = groundAt(cx0, cz0, camera.position.y + 2) ?? sampleHeight(cx0, cz0) ?? (camera.position.y - 1.6);
    } else if (mode === 'coords') {
      cx0 = drop.x; cz0 = drop.z;
      cy0 = groundAt(cx0, cz0, arenaY + 60) ?? sampleHeight(cx0, cz0) ?? arenaY;
    }
    // Cast from WELL ABOVE the whole arena (peaks reach ~100 m) so we always hit the TOP surface, not a
    // lower layer underneath — casting from cy0+small missed any terrain that rises above it and buried
    // the monster in the layer below.
    const groundAtPt = (x: number, z: number) => groundAt(x, z, cy0 + 200) ?? sampleHeight(x, z) ?? cy0;
    const pushAt = (mx: number, mz: number, ground: number) => {
      const y = drop.dropHeight != null ? ground + drop.dropHeight : ground;
      out.push({ id: `chal${r.runId}_${r.idc++}`, type: drop.type, spawn: [mx, y, mz],
        ov: drop.type === 6 ? makeHordeMember() : undefined, mods, color: drop.color, rise: drop.dropHeight == null });
    };
    const n = drop.count;

    if (mode === 'grid') {
      // Evenly-spaced square grid centred on the player, straddled by half a cell so none lands ON them.
      const spacing = drop.pattern?.spacing && drop.pattern.spacing > 0 ? drop.pattern.spacing : 3;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      for (let k = 0; k < n; k++) {
        const col = k % cols, row = Math.floor(k / cols);
        const ox = (col - (cols - 1) / 2 + 0.5) * spacing;
        const oz = (row - (rows - 1) / 2 + 0.5) * spacing;
        const mx = cx0 + ox, mz = cz0 + oz;
        pushAt(mx, mz, groundAtPt(mx, mz));
      }
      return out;
    }
    if (mode === 'circle') {
      // One ring around the player, evenly spaced by count; radius scales with horde size if unset.
      const R = drop.pattern?.radius && drop.pattern.radius > 0 ? drop.pattern.radius : Math.max(6, n * 0.6);
      for (let k = 0; k < n; k++) {
        const a = (Math.PI * 2 * k) / Math.max(1, n);
        const mx = cx0 + Math.cos(a) * R, mz = cz0 + Math.sin(a) * R;
        pushAt(mx, mz, groundAtPt(mx, mz));
      }
      return out;
    }
    if (mode === 'coords') {
      // All at the authored point; a horde clusters in a tight ring so they don't perfectly overlap.
      if (n <= 1) { pushAt(cx0, cz0, groundAtPt(cx0, cz0)); return out; }
      const R = 1 + n * 0.15;
      for (let k = 0; k < n; k++) {
        const a = (Math.PI * 2 * k) / n;
        const mx = cx0 + Math.cos(a) * R, mz = cz0 + Math.sin(a) * R;
        pushAt(mx, mz, groundAtPt(mx, mz));
      }
      return out;
    }

    // RANDOM (explicit pattern, around the player) OR LEGACY (no pattern, around the arena): each monster
    // gets its OWN open point in a min–max ring. Keep them on terrain connected to the centre's level
    // (within BAND m) and skip spots trapped under a roof/overhang.
    const scatter = mode === 'random'
      ? (drop.pattern?.maxDist && drop.pattern.maxDist > 0 ? drop.pattern.maxDist : (ch.scatterRadius && ch.scatterRadius > 0 ? ch.scatterRadius : 45))
      : (ch.scatterRadius && ch.scatterRadius > 0 ? ch.scatterRadius : 45);
    const minR = mode === 'random' && drop.pattern?.minDist != null ? Math.max(0, drop.pattern.minDist) : Math.min(12, scatter * 0.4);
    for (let i = 0; i < n; i++) {
      const BAND = 12;
      let mx = cx0, mz = cz0, ground = cy0, placed = false, haveBest = false;
      for (let t = 0; t < 20; t++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = minR + Math.sqrt(Math.random()) * Math.max(0.001, scatter - minR);   // sqrt → uniform over the area
        const tx = cx0 + Math.cos(ang) * rr, tz = cz0 + Math.sin(ang) * rr;
        const g = groundAt(tx, tz, cy0 + 200) ?? sampleHeight(tx, tz);   // TRUE top surface (high ceiling), then keep near the player's level
        if (g == null || Math.abs(g - cy0) > BAND) continue;
        if (!haveBest) { mx = tx; mz = tz; ground = g; haveBest = true; }
        if (raycastMesh(tx, g + 0.6, tz, 0, 1, 0, 6) != null) continue;
        mx = tx; mz = tz; ground = g; placed = true; break;
      }
      if (!placed && !haveBest) {
        const a = Math.random() * Math.PI * 2;
        mx = cx0 + Math.cos(a) * Math.max(minR, 4); mz = cz0 + Math.sin(a) * Math.max(minR, 4); ground = cy0;
      }
      pushAt(mx, mz, ground);
    }
    return out;
  };

  const startWave = (now: number) => {
    const wave = challengeRef.current!.waves[r.waveIdx];
    // Build the spawn schedule. A staggered drop spreads its `count` one-per-staggerMs (this wave
    // only — replacing r.pending on the next wave drops any not-yet-spawned ones).
    r.pending = [];
    let acc = 0;   // ms from wave start — each spawn's afterSec is relative to the previous one
    wave.drops.forEach((drop, dropIdx) => {
      acc += (drop.afterSec ?? 0) * 1000;
      const base = now + acc;
      const dropSeed = r.waveIdx * 10000 + dropIdx * 100;
      // Grid/Circle are surround formations that spawn TOGETHER — stagger only applies to random/coords.
      const canStagger = !drop.pattern || drop.pattern.mode === 'random' || drop.pattern.mode === 'coords';
      if (drop.staggerMs && drop.count > 1 && canStagger) {
        // Each staggered monster gets its OWN seeded point (different + learnable).
        for (let i = 0; i < drop.count; i++) {
          r.pending.push({ drop: { ...drop, count: 1 }, at: base + i * drop.staggerMs, seed: dropSeed + 1 + i, spread: false });
        }
      } else {
        // Single monster → its point; horde (count>1) → one point, clustered.
        r.pending.push({ drop, at: base, seed: dropSeed, spread: drop.count > 1 });
      }
    });
    r.dropsDone = r.pending.length === 0;
    r.sawAlive = false;
    r.waveEndsAt = now + wave.timeSec * 1000;
    const n = r.waveIdx + 1;
    const faint = r.faintNext;
    setChallengeState({
      active: true, wave: n, waveEndsAt: r.waveEndsAt, completed: false,
      announce: { title: `Wave ${n}/${challengeRef.current!.waves.length}`, subtitle: wave.name, image: wave.image, text: wave.text, faint, until: now + (faint ? 1500 : 3000) },
    });
  };

  const start = (ch: Challenge) => {
    const now = performance.now();
    challengeRef.current = ch;
    setMobs([]);
    setSiegePlayerDead(false);   // a ghost from a prior death comes back to life for the new run
    fireChallengeRevive();       // restore full health (no-op if already alive)
    resetChallengeScore();
    prePos.current = camera.position.clone();   // remember where to put the player back
    preMap.current = getActiveMapId();
    const jump = (window as unknown as { __siegeJump?: (m: string, p: [number, number, number], y?: number, pi?: number) => void }).__siegeJump;
    const arr = ch.mapId ? challengeWorldArrival(ch.mapId) : null;             // baked world → its fixed drop point + facing
    if (ch.mapId && ch.mapId !== preMap.current && jump) {
      jump(ch.mapId, arr?.pos ?? ch.spawn ?? [0, 3, 0], arr?.yaw, arr?.pitch);  // switch world, arrive at the drop point
    } else if (arr?.pos || ch.spawn) {
      const p = arr?.pos ?? ch.spawn!;
      camera.position.set(p[0], p[1], p[2]);                                    // same map → teleport to the arena
    }
    // Baked worlds (city, etc.): the scene's BVH ground loads a moment AFTER arrival, so the player can
    // hover in the air until it's ready (an exploit — sit up high and shoot down). Snap them down onto
    // the street as soon as the ground exists.
    if (arr?.pos) groundSnap.current = { until: now + 15000, ceil: arr.pos[1] + 3, holdY: arr.pos[1] };
    r.runId++; r.waveIdx = 0; r.active = true; r.faintNext = false; r.startedAt = now; r.idc = 0;
    // 10s pre-game countdown: ready weapons while it counts; wave 1 (and its timer) start after,
    // so these seconds don't eat the wave. START NOW (fireChallengeSkip) jumps straight in.
    r.countdownUntil = now + 10000;
    setChallengeState({ active: true, name: ch.name, totalWaves: ch.waves.length, startedAt: now, completed: false, finishedAt: 0, result: null, wave: 0, waveEndsAt: 0, countdownUntil: r.countdownUntil, announce: null });
  };

  const revert = () => {
    const p = prePos.current; if (!p) return;
    const jump = (window as unknown as { __siegeJump?: (m: string, q: [number, number, number]) => void }).__siegeJump;
    if (preMap.current && preMap.current !== getActiveMapId() && jump) jump(preMap.current, [p.x, p.y, p.z]);  // back to the prior map + spot
    else camera.position.copy(p);
  };

  const stop = () => {
    r.active = false; r.countdownUntil = 0;
    setSiegePlayerDead(false);
    setMobs([]);
    revert();
    setChallengeState({ active: false, completed: false, announce: null, wave: 0, waveEndsAt: 0, countdownUntil: 0, result: null });
  };

  // Record one play to the leaderboard. Only SAVED challenges (with an id) have a board — the
  // built-in test challenge is skipped. Fire-and-forget; a failed insert never disrupts gameplay.
  const record = (completed: boolean, now: number) => {
    const ch = challengeRef.current;
    if (!ch?.id) return;
    void recordChallengeRun({
      challengeId: ch.id, userId: user?.id ?? null, playerName: user?.email?.split('@')[0] ?? null,
      game: ch.game ?? getActiveGame(), score: getChallengeScore(),
      timeMs: Math.round(now - r.startedAt), waveReached: r.waveIdx + 1, completed,
    });
  };

  // Post-challenge result panel (any challenge, incl. the test one) — lets the player retry or browse.
  const showResult = (outcome: 'win' | 'lose', now: number) => {
    const ch = challengeRef.current; if (!ch) return;
    setChallengeState({ result: {
      outcome, name: ch.name, score: Math.round(getChallengeScore()),
      timeMs: Math.round(now - r.startedAt), wave: r.waveIdx + 1, totalWaves: ch.waves.length, challenge: ch,
    } });
  };

  // Player died mid-challenge → YOU LOSE!, end the run. The player is NOT teleported out — they stay
  // where they fell as a ghost, and the monsters (kept alive, not cleared) lose their target and
  // wander off (MonsterEnemy reads the siege-player-dead flag). They come back to life on the next run.
  const lose = () => {
    if (!r.active) return;
    const now = performance.now();
    record(false, now);
    showResult('lose', now);
    r.active = false;
    setSiegePlayerDead(true);   // monsters stop hunting + wander off; player frozen as a ghost
    setChallengeState({
      active: false, completed: false, waveEndsAt: 0,
      announce: { title: 'YOU LOSE!', subtitle: `Reached Wave ${r.waveIdx + 1}/${challengeRef.current!.waves.length}`, text: `Points: ${Math.round(getChallengeScore())}`, faint: false, until: now + 6000 },
    });
  };

  // Started/stopped via the "!c" spawner command; lost when the player dies (damage pipeline).
  useEffect(() => {
    setChallengeToggle(() => { if (r.active) stop(); else start(TEST_CHALLENGE); });
    setChallengeLose(() => lose());
    setChallengeStart((ch) => { if (r.active) stop(); start(ch); });   // play an authored challenge
    setChallengeSkip(() => { if (r.active && r.countdownUntil) r.countdownUntil = performance.now(); });  // START NOW
    return () => { setChallengeToggle(null); setChallengeLose(null); setChallengeStart(null); setChallengeSkip(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Score: damage to siege monsters → points while a challenge is active. Headshots already deal
  // 2× damage, so ×1.5 here makes a headshot worth 3× the points of the equivalent body shot.
  useEffect(() => {
    setSiegeScoreHook((dmg, headshot) => { if (r.active) addChallengeScore(dmg * (headshot ? 1.5 : 1)); });
    return () => setSiegeScoreHook(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeMob = (id: string) => setMobs((m) => m.filter((x) => x.id !== id));

  useFrame(() => {
    if (!r.active) return;
    const now = performance.now();

    // Drop the player onto the street once the baked world's BVH ground is available (fixes spawning
    // 20m in the air and hovering there until you move).
    if (groundSnap.current) {
      // The ground here is the baked MESH (no real heightmap), and 80+ collider meshes build in the
      // BACKGROUND — so the surface isn't ready for a moment after arrival. Cast from a FIXED ceiling
      // just above the intended spawn (NOT the live camera Y, which drops as the player falls — on a
      // high arena that dropped ceiling can no longer see the real ground above it, the bug that left
      // you stuck at the bottom). HOLD the player at the spawn until the mesh is ready instead of
      // letting them sink through to the lower terrain layer, then snap eye = ground + 1.6.
      const gc = groundSnap.current.ceil;
      const g = meshGroundHeight(camera.position.x, camera.position.z, gc)
             ?? groundAt(camera.position.x, camera.position.z, gc);
      if (g != null) { camera.position.y = g + 1.6; groundSnap.current = null; }
      else if (now > groundSnap.current.until) groundSnap.current = null;
      else camera.position.y = groundSnap.current.holdY;   // not ready yet → hold at spawn, don't fall through
    }

    // 0. Pre-game countdown: hold until it ends (or START NOW set it to the past), THEN wave 1.
    if (r.countdownUntil) {
      if (now >= r.countdownUntil) { r.countdownUntil = 0; setChallengeState({ countdownUntil: 0 }); startWave(now); }
      return;
    }

    // 1. Spawn drops whose time has come.
    if (r.pending.length) {
      const due = r.pending.filter((p) => p.at <= now);
      if (due.length) {
        r.pending = r.pending.filter((p) => p.at > now);
        const fresh = due.flatMap((p) => buildMobs(p.drop, p.seed, p.spread));
        if (fresh.length) setMobs((m) => [...m, ...fresh]);
      }
      if (!r.pending.length) r.dropsDone = true;
    }

    // 2. Count this run's still-alive monsters (across all waves — carry-overs included).
    const prefix = `chal${r.runId}_`;
    let alive = 0;
    for (let i = 0; i < siegeDemons.length; i++) {
      const d = siegeDemons[i];
      if (!d.dead && d.id.indexOf(prefix) === 0) alive++;
    }
    if (alive > 0) r.sawAlive = true;   // guard: don't "clear" before the mobs have registered

    // 3. Wave transitions.
    const lastWave = r.waveIdx >= challengeRef.current!.waves.length - 1;
    if (r.dropsDone && r.sawAlive && alive === 0) {
      // Wave cleared (every monster dead) → next wave immediately, or finish.
      if (lastWave) finish(now); else { r.waveIdx++; r.faintNext = false; startWave(now); }
    } else if (!lastWave && now > r.waveEndsAt) {
      // Time up with monsters still alive → carry them over; next announcement is faint + brief.
      r.waveIdx++; r.faintNext = true; startWave(now);
    }
  });

  const finish = (now: number) => {
    record(true, now);
    showResult('win', now);
    r.active = false;
    setChallengeState({
      active: false, completed: true, finishedAt: now, waveEndsAt: 0,
      announce: { title: 'Challenge Complete!', subtitle: `${Math.round(getChallengeScore())} points`, text: `Time: ${((now - r.startedAt) / 1000).toFixed(1)}s`, faint: false, until: now + 8000 },
    });
    setMobs([]);
  };

  return (
    <>
      {mobs.map((s) => (
        <CatalogMonster key={s.id} id={s.id} type={s.type} spawn={s.spawn} ov={s.ov} mods={s.mods} color={s.color}
                        riseFromGround={s.rise} onDespawn={removeMob} />
      ))}
    </>
  );
}
