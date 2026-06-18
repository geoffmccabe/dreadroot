// RegionSpawnerRunner — the Open-World ambient spawner. A superadmin tags a saved Challenge with a
// region (e.g. Beach); this component plays that challenge's spawn sequence at the region's
// coordinates and LOOPS it forever while a player is in the world, so each region keeps a steady
// flow of its authored monsters. It pauses while a hand-started Challenge is running (that takes
// over the world). Lives inside the Canvas; spawns through CatalogMonster like ChallengeRunner.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CatalogMonster, makeHordeMember, type MType, type Ov, type MonsterMods } from '../siegeMonsterCatalog';
import { sampleHeight } from '../terrainHeight';
import { getChallengeState } from './challengeStore';
import { listRegionChallenges } from './challengeStorage';
import { regionCoords } from './regionDefaults';
import { useActiveGame } from '@/config/activeGame';
import type { Challenge, MonsterDrop } from './challengeTypes';

interface Spawned { id: string; type: MType; spawn: [number, number, number]; ov?: Ov; mods?: MonsterMods; rise: boolean; }
interface Sched { id: string; coords: [number, number, number]; radius: number; events: { t: number; drop: MonsterDrop }[]; period: number; start: number; idx: number; }

const CAP = 35;   // max alive monsters per region (keeps a runaway loop in check)

// Flatten a challenge into a timeline of spawn events (ms from cycle start), looping every `period`.
function buildSched(ch: Challenge): Sched {
  const events: { t: number; drop: MonsterDrop }[] = [];
  let t = 0;
  for (const wave of ch.waves) {
    let acc = 0;
    for (const drop of wave.drops) { acc += (drop.afterSec ?? 0) * 1000; events.push({ t: t + acc, drop }); }
    t += (wave.timeSec || 60) * 1000;
  }
  const last = events.length ? events[events.length - 1].t : 0;
  return { id: ch.id!, coords: ch.spawn ?? regionCoords(ch.region), radius: ch.scatterRadius ?? 14, events, period: Math.max(t, last + 4000), start: 0, idx: 0 };
}

function build(s: Sched, drop: MonsterDrop, idc: { n: number }): Spawned[] {
  const out: Spawned[] = [];
  const mods: MonsterMods | undefined = drop.boss
    ? { sizeMul: drop.boss.sizePct / 100, speedMul: drop.boss.speedPct / 100, healthMul: drop.boss.healthPct / 100, damageMul: drop.boss.damagePct / 100 }
    : undefined;
  for (let i = 0; i < (drop.count || 1); i++) {
    const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * s.radius;
    const mx = s.coords[0] + Math.cos(ang) * rr, mz = s.coords[2] + Math.sin(ang) * rr;
    const ground = sampleHeight(mx, mz) ?? s.coords[1] ?? 26;
    const y = drop.dropHeight != null ? ground + drop.dropHeight : ground;
    out.push({ id: `${s.id}_${idc.n++}`, type: drop.type as MType, spawn: [mx, y, mz], ov: drop.type === 6 ? makeHordeMember() : undefined, mods, rise: drop.dropHeight == null });
  }
  return out;
}

export function RegionSpawnerRunner() {
  const game = useActiveGame();                    // reactive: re-fetch + reset when the game switches
  const [mobs, setMobs] = useState<Spawned[]>([]);
  const scheds = useRef<Sched[]>([]);
  const idc = useRef({ n: 0 });
  // Live alive-count per schedule id, kept in a ref so the CAP is a HARD cap with no React-commit lag
  // (reading `mobs` state inside useFrame is one-or-more commits stale and lets bursts blow past CAP).
  const alive = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    listRegionChallenges(game).then((rows) => {
      if (cancelled) return;
      scheds.current = rows
        .filter((r) => r.data?.waves?.some((w) => w.drops?.length))
        .map((r) => buildSched({ ...r.data, id: r.id, region: r.region ?? undefined }));
      alive.current.clear();
      setMobs([]);                                 // drop the previous game's spawned monsters
    });
    return () => { cancelled = true; };
  }, [game]);

  const remove = (id: string) => {
    setMobs((m) => m.filter((x) => x.id !== id));
    const sid = id.slice(0, id.lastIndexOf('_'));  // mob id = `${scheduleId}_${n}`
    const n = alive.current.get(sid);
    if (n) alive.current.set(sid, n - 1);          // free a CAP slot immediately
  };

  useFrame(() => {
    if (getChallengeState().active) return;        // a hand-started challenge owns the world
    if (!scheds.current.length) return;
    const now = performance.now();
    const add: Spawned[] = [];
    for (const s of scheds.current) {
      if (s.start === 0) s.start = now;
      const phase = now - s.start;
      let n = alive.current.get(s.id) ?? 0;
      while (s.idx < s.events.length && s.events[s.idx].t <= phase) {
        const ev = s.events[s.idx]; s.idx++;
        if (n >= CAP) continue;                     // hard cap — still advance the cursor so timing holds
        const made = build(s, ev.drop, idc.current);
        const take = made.length <= CAP - n ? made : made.slice(0, CAP - n);
        add.push(...take); n += take.length; alive.current.set(s.id, n);
      }
      if (s.idx >= s.events.length && phase >= s.period) { s.start = now; s.idx = 0; }   // loop
    }
    if (add.length) setMobs((m) => [...m, ...add]);
  });

  return <>{mobs.map((s) => (
    <CatalogMonster key={s.id} id={s.id} type={s.type} spawn={s.spawn} ov={s.ov} mods={s.mods} riseFromGround={s.rise} onDespawn={remove} />
  ))}</>;
}
