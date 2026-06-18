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
import { setChallengeState } from './challengeStore';
import { setChallengeToggle } from './challengeControl';
import { resetChallengeScore, addChallengeScore } from './challengeScore';
import { TEST_CHALLENGE } from './testChallenge';
import type { Challenge, MonsterDrop } from './challengeTypes';

interface Spawned { id: string; type: MType; spawn: [number, number, number]; ov?: Ov; mods?: MonsterMods; rise: boolean; }

export function ChallengeRunner() {
  const camera = useThree((s) => s.camera);
  const [mobs, setMobs] = useState<Spawned[]>([]);
  const challengeRef = useRef<Challenge | null>(null);
  const r = useRef({
    active: false, runId: 0, waveIdx: 0, waveEndsAt: 0, startedAt: 0,
    pending: [] as { drop: MonsterDrop; at: number }[], dropsDone: false, sawAlive: false,
    faintNext: false, idc: 0,
  }).current;

  const buildMobs = (drop: MonsterDrop): Spawned[] => {
    const out: Spawned[] = [];
    const ground = sampleHeight(drop.x, drop.z) ?? 26;
    const baseY = drop.dropHeight != null ? ground + drop.dropHeight : ground;
    const rise = drop.dropHeight == null;                       // no explicit height → rise from floor
    const rad = drop.count <= 1 ? 0 : Math.min(8, 1 + Math.sqrt(drop.count));
    const mods: MonsterMods | undefined = drop.boss
      ? { sizeMul: drop.boss.sizePct / 100, speedMul: drop.boss.speedPct / 100, healthMul: drop.boss.healthPct / 100 }
      : undefined;
    for (let i = 0; i < drop.count; i++) {
      const ang = Math.random() * Math.PI * 2, d = Math.random() * rad;
      out.push({
        id: `chal${r.runId}_${r.idc++}`, type: drop.type,
        spawn: [drop.x + Math.cos(ang) * d, baseY, drop.z + Math.sin(ang) * d],
        ov: drop.type === 6 ? makeHordeMember() : undefined, mods, rise,
      });
    }
    return out;
  };

  const startWave = (now: number) => {
    const wave = challengeRef.current!.waves[r.waveIdx];
    r.pending = wave.drops.map((drop) => ({ drop, at: now + (drop.delayMs ?? 0) }));
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
    if (ch.spawn) camera.position.set(ch.spawn[0], ch.spawn[1], ch.spawn[2]);   // teleport to the arena
    r.runId++; r.waveIdx = 0; r.active = true; r.faintNext = false; r.startedAt = now; r.idc = 0;
    setChallengeState({ active: true, name: ch.name, totalWaves: ch.waves.length, startedAt: now, completed: false, finishedAt: 0 });
    startWave(now);
  };

  const stop = () => {
    r.active = false;
    setMobs([]);
    setChallengeState({ active: false, completed: false, announce: null, wave: 0, waveEndsAt: 0 });
  };

  // Started/stopped via the "!c" spawner command (registered here as a toggle).
  useEffect(() => {
    setChallengeToggle(() => { if (r.active) stop(); else start(TEST_CHALLENGE); });
    return () => setChallengeToggle(null);
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
        const fresh = due.flatMap((p) => buildMobs(p.drop));
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
    r.active = false;
    setChallengeState({
      active: false, completed: true, finishedAt: now, waveEndsAt: 0,
      announce: { title: 'Challenge Complete!', subtitle: `Time: ${((now - r.startedAt) / 1000).toFixed(1)}s`, faint: false, until: now + 8000 },
    });
    setMobs([]);
  };

  return (
    <>
      {mobs.map((s) => (
        <CatalogMonster key={s.id} id={s.id} type={s.type} spawn={s.spawn} ov={s.ov} mods={s.mods}
                        riseFromGround={s.rise} onDespawn={removeMob} />
      ))}
    </>
  );
}
