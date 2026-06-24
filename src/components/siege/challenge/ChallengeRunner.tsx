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
import { raycastMesh } from '../meshColliderSystem';
import * as THREE from 'three';
import { setChallengeState } from './challengeStore';
import { setChallengeToggle, setChallengeLose, setChallengeStart } from './challengeControl';
import { resetChallengeScore, addChallengeScore, getChallengeScore } from './challengeScore';
import { recordChallengeRun } from './challengeStorage';
import { TEST_CHALLENGE } from './testChallenge';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveGame } from '@/config/activeGame';
import { getActiveMapId } from '@/config/activeMap';
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
  const prePos = useRef<THREE.Vector3 | null>(null);   // where the player was before the challenge
  const preMap = useRef<string | null>(null);          // which map, so we can jump back on finish
  const r = useRef({
    active: false, runId: 0, waveIdx: 0, waveEndsAt: 0, startedAt: 0,
    pending: [] as { drop: MonsterDrop; at: number; seed: number; spread: boolean }[], dropsDone: false, sawAlive: false,
    faintNext: false, idc: 0,
  }).current;

  const buildMobs = (drop: MonsterDrop, _seed: number, _spread: boolean): Spawned[] => {
    const out: Spawned[] = [];
    const ch = challengeRef.current!;
    // Spread spawns AROUND the arena instead of dripping from one point. Centre = the arena arrival
    // (baked world) or the authored spawn. Each monster gets its OWN random point in a wide ring
    // (min radius keeps them off the player's lap), so they come at you from all over the map.
    const arr = ch.mapId ? challengeWorldArrival(ch.mapId) : null;
    const cx0 = arr?.pos[0] ?? ch.spawn?.[0] ?? drop.x;
    const cy0 = arr?.pos[1] ?? ch.spawn?.[1] ?? 26;
    const cz0 = arr?.pos[2] ?? ch.spawn?.[2] ?? drop.z;
    const scatter = ch.scatterRadius && ch.scatterRadius > 0 ? ch.scatterRadius : 45;
    const minR = Math.min(12, scatter * 0.4);
    const mods: MonsterMods | undefined = drop.boss
      ? { sizeMul: drop.boss.sizePct / 100, speedMul: drop.boss.speedPct / 100, healthMul: drop.boss.healthPct / 100, damageMul: drop.boss.damagePct / 100 }
      : undefined;
    for (let i = 0; i < drop.count; i++) {
      // Pick an OPEN spawn point: on the street near the player's level, with open sky above. Rejects
      // spots inside/under a building (a roof overhead) or on a roof/in a pit (wrong level) — those
      // were trapping monsters where you could hear but never reach them. Falls back to the arena
      // centre (the known-open drop point) if no open spot is found.
      let mx = cx0, mz = cz0, ground = cy0;
      for (let t = 0; t < 16; t++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = minR + Math.sqrt(Math.random()) * (scatter - minR);   // sqrt → uniform over the area
        const tx = cx0 + Math.cos(ang) * rr, tz = cz0 + Math.sin(ang) * rr;
        const g = groundAt(tx, tz, cy0 + 4);
        if (g == null || Math.abs(g - cy0) > 2.5) continue;              // void / not street level
        if (raycastMesh(tx, g + 0.6, tz, 0, 1, 0, 5) != null) continue;  // a roof within 5m → enclosed
        mx = tx; mz = tz; ground = g; break;
      }
      const y = drop.dropHeight != null ? ground + drop.dropHeight : ground;
      out.push({
        id: `chal${r.runId}_${r.idc++}`, type: drop.type, spawn: [mx, y, mz],
        ov: drop.type === 6 ? makeHordeMember() : undefined, mods, color: drop.color,
        rise: drop.dropHeight == null,
      });
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
      if (drop.staggerMs && drop.count > 1) {
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
    r.runId++; r.waveIdx = 0; r.active = true; r.faintNext = false; r.startedAt = now; r.idc = 0;
    setChallengeState({ active: true, name: ch.name, totalWaves: ch.waves.length, startedAt: now, completed: false, finishedAt: 0, result: null });
    startWave(now);
  };

  const revert = () => {
    const p = prePos.current; if (!p) return;
    const jump = (window as unknown as { __siegeJump?: (m: string, q: [number, number, number]) => void }).__siegeJump;
    if (preMap.current && preMap.current !== getActiveMapId() && jump) jump(preMap.current, [p.x, p.y, p.z]);  // back to the prior map + spot
    else camera.position.copy(p);
  };

  const stop = () => {
    r.active = false;
    setMobs([]);
    revert();
    setChallengeState({ active: false, completed: false, announce: null, wave: 0, waveEndsAt: 0, result: null });
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

  // Player died mid-challenge → YOU LOSE!, end it, and put the world back the way it was.
  const lose = () => {
    if (!r.active) return;
    const now = performance.now();
    record(false, now);
    showResult('lose', now);
    r.active = false;
    setMobs([]);
    revert();
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
    return () => { setChallengeToggle(null); setChallengeLose(null); setChallengeStart(null); };
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
