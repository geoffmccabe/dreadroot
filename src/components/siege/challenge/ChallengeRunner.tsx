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
import { getLastPlayerAttacker, clearLastPlayerAttacker } from '../spray/sprayAttackSystem';
import * as THREE from 'three';
import { setChallengeState } from './challengeStore';
import { setChallengeToggle, setChallengeLose, setChallengeStart, setChallengeSkip, setChallengeExit, fireChallengeRevive } from './challengeControl';
import { setSiegePlayerDead, setSiegeSpawnPin } from '../siegePlayerState';
import { startSpawnIntro, requestIntroBypass, endSiegeIntro, isSiegeIntroActive } from '../spawnintro/siegeSpawnIntro';
import { resetChallengeScore, addChallengeScore, getChallengeScore } from './challengeScore';
import { recordChallengeRun, saveChallenge } from './challengeStorage';
import { enterLookContext, exitLookContext, type LookState } from '@/features/look/lookStore';
import { TEST_CHALLENGE } from './testChallenge';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveGame } from '@/config/activeGame';
import { getActiveMapId, useActiveMapId } from '@/config/activeMap';
import { challengeWorldArrival } from '../siegeAreas';
import type { Challenge, MonsterDrop, ColorMods } from './challengeTypes';

interface Spawned { id: string; type: MType; spawn: [number, number, number]; ov?: Ov; mods?: MonsterMods; color?: ColorMods; ballColor?: string; rise: boolean; }

// How often to recompute the run's alive-monster count (wave-clear detection isn't frame-sensitive).
const ALIVE_SCAN_MS = 160;

export function ChallengeRunner() {
  const camera = useThree((s) => s.camera);
  const { user } = useAuth();
  const [mobs, setMobs] = useState<Spawned[]>([]);
  const challengeRef = useRef<Challenge | null>(null);
  const groundSnap = useRef<{ until: number; ceil: number; holdY: number } | null>(null);   // drop the player onto the street once its BVH loads
  const prePos = useRef<THREE.Vector3 | null>(null);   // where the player was before the challenge
  const preMap = useRef<string | null>(null);          // which map, so we can jump back on finish
  const lookSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);   // debounce per-challenge look saves
  const r = useRef({
    active: false, runId: 0, waveIdx: 0, waveEndsAt: 0, startedAt: 0, countdownUntil: 0,
    pending: [] as { drop: MonsterDrop; at: number; seed: number; spread: boolean }[], dropsDone: false, sawAlive: false,
    faintNext: false, idc: 0,
    aliveCount: 0, lastAliveAt: 0,   // throttled alive-count (recomputed ~6×/s, not every frame)
  }).current;

  // Leaving the arena (Cmd-J / teleport to another world) must END the challenge and clear its mobs —
  // otherwise they keep chasing the camera into the new world AND new waves keep spawning there.
  const mapId = useActiveMapId();
  useEffect(() => {
    const ch = challengeRef.current;
    const arenaMap = ch?.mapId || preMap.current || '';
    if (r.active && mapId !== arenaMap) {
      r.active = false; r.countdownUntil = 0; r.pending = [];
      exitLookContext();   // left the arena → restore the global/world look
      setSiegeSpawnPin(null); groundSnap.current = null;
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
    // Ray-trace the BAKED MESH from high above (peaks ~100 m) to get the TRUE top surface at a point.
    // `sampleHeight` here is a flat fallback plane at Y=0 — a FALSE floor UNDER this elevated map — so
    // only trust it when it sits near the reference level, and NEVER let it bury a spawn at 0 while the
    // mesh BVH is still building; fall back to the reference (player's / arena's own level) instead.
    const meshGround = (x: number, z: number, ref: number) => {
      const m = groundAt(x, z, ref + 200);
      if (m != null) return m;
      const s = sampleHeight(x, z);
      return (s != null && Math.abs(s - ref) <= 12) ? s : ref;
    };
    const arenaY = meshGround(ax, az, ayRaw);

    // PATTERN CENTRE. random/grid/circle surround the PLAYER's live position when the spawn fires;
    // coords uses the authored world point; legacy (no pattern) uses the arena centre.
    const mode = drop.pattern?.mode;
    const playerCentred = mode === 'random' || mode === 'grid' || mode === 'circle';
    let cx0 = ax, cz0 = az, cy0 = arenaY;
    if (playerCentred) {
      cx0 = camera.position.x; cz0 = camera.position.z;
      // Reference = the player's OWN foot level (they're standing on the real ground), so a not-ready
      // mesh never collapses cy0 to the false 0 plane.
      cy0 = meshGround(cx0, cz0, camera.position.y - 1.6);
    } else if (mode === 'coords') {
      cx0 = drop.x; cz0 = drop.z;
      cy0 = meshGround(cx0, cz0, arenaY);
    }
    // Cast from WELL ABOVE the whole arena (peaks reach ~100 m) so we always hit the TOP surface, not a
    // lower layer underneath — casting from cy0+small missed any terrain that rises above it and buried
    // the monster in the layer below.
    const groundAtPt = (x: number, z: number) => meshGround(x, z, cy0);
    const pushAt = (mx: number, mz: number, ground: number) => {
      const y = drop.dropHeight != null ? ground + drop.dropHeight : ground;
      out.push({ id: `chal${r.runId}_${r.idc++}`, type: drop.type, spawn: [mx, y, mz],
        ov: drop.type === 6 ? makeHordeMember() : undefined, mods, color: drop.color, ballColor: drop.ballColor, rise: drop.dropHeight == null });
    };
    const n = drop.count;

    if (mode === 'grid') {
      // Evenly-spaced square grid CENTRED on the player. Build one extra cell, drop the cell nearest
      // the player (so none spawns on top of them), and take n — symmetric for any count.
      const spacing = drop.pattern?.spacing && drop.pattern.spacing > 0 ? drop.pattern.spacing : 3;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n + 1)));
      const rows = Math.ceil((n + 1) / cols);
      const cells: [number, number, number][] = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const ox = (col - (cols - 1) / 2) * spacing, oz = (row - (rows - 1) / 2) * spacing;
        cells.push([ox, oz, ox * ox + oz * oz]);
      }
      cells.sort((a, b) => a[2] - b[2]);   // nearest the player first → skip cells[0]
      for (let k = 1; k <= n && k < cells.length; k++) {
        const mx = cx0 + cells[k][0], mz = cz0 + cells[k][1];
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
    // Clamp the inner radius below the outer so a min ≥ max never collapses the ring to a thin band.
    const minR = Math.min(
      mode === 'random' && drop.pattern?.minDist != null ? Math.max(0, drop.pattern.minDist) : Math.min(12, scatter * 0.4),
      scatter * 0.9,
    );
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
    r.aliveCount = 0; r.lastAliveAt = 0;   // force a fresh scan this wave (no stale carry-over)
    r.waveEndsAt = now + wave.timeSec * 1000;
    const n = r.waveIdx + 1;
    const faint = r.faintNext;
    setChallengeState({
      active: true, wave: n, waveEndsAt: r.waveEndsAt, completed: false,
      announce: { title: `Wave ${n}/${challengeRef.current!.waves.length}`, subtitle: wave.name, image: wave.image, text: wave.text, faint, until: now + (faint ? 1500 : 3000) },
    });
  };

  // Persist a live-edited challenge look back to its DB row, debounced. Only SAVED challenges (with an
  // id) and a logged-in user attempt a write; RLS enforces ownership server-side, so a non-owner's live
  // tweak simply stays session-local (the failed update is ignored). Fire-and-forget — never blocks play.
  const persistChallengeLook = (ch: Challenge) => (look: LookState) => {
    ch.look = look;
    if (!ch.id || !user) return;
    if (lookSaveTimer.current) clearTimeout(lookSaveTimer.current);
    lookSaveTimer.current = setTimeout(() => {
      const creator = ch.creator || user.email?.split('@')[0] || 'unknown';
      void saveChallenge(ch, user.id, creator).catch(() => { /* RLS rejected (not owner) — keep it local */ });
    }, 800);
  };

  const start = (ch: Challenge) => {
    const now = performance.now();
    challengeRef.current = ch;
    // Per-instance lighting: apply THIS challenge's saved look (or inherit the map's current look if it
    // has none), restoring on exit. Authors tuning the Lighting Panel during the run save back here.
    enterLookContext(`challenge:${ch.id ?? 'test'}`, ch.look, persistChallengeLook(ch));
    setMobs([]);
    setSiegePlayerDead(false);   // a ghost from a prior death comes back to life for the new run
    fireChallengeRevive();       // restore full health (no-op if already alive)
    clearLastPlayerAttacker();   // fresh run → forget who killed them last time
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
    if (arr?.pos) {
      groundSnap.current = { until: now + 30000, ceil: arr.pos[1] + 8, holdY: arr.pos[1] };
      setSiegeSpawnPin(arr.pos[1]);   // PIN the player at the authored spawn Y until the real ground there is ready
    }
    r.runId++; r.waveIdx = 0; r.active = true; r.faintNext = false; r.startedAt = now; r.idc = 0;
    // 10s pre-game countdown: ready weapons while it counts; wave 1 (and its timer) start after,
    // so these seconds don't eat the wave. START NOW (fireChallengeSkip) jumps straight in.
    r.countdownUntil = now + 10000;
    setChallengeState({ active: true, name: ch.name, totalWaves: ch.waves.length, startedAt: now, completed: false, finishedAt: 0, result: null, wave: 0, waveEndsAt: 0, countdownUntil: r.countdownUntil, announce: null });
    // Cinematic spawn: the character arrives facing the camera, the world loads, then on the final
    // beat it turns away + the camera dollies into its head → FPS, timed to finish exactly when the
    // countdown hits zero. Owns the camera while it plays (FortressControls stands down). ALWAYS fire:
    // arena arrival, else the challenge's own spawn, else wherever the player now is (in-place runs).
    const introPos: [number, number, number] = arr?.pos ?? ch.spawn ?? [camera.position.x, camera.position.y, camera.position.z];
    const introYaw = arr?.yaw ?? new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    startSpawnIntro(introPos, introYaw, { countdownEndsAt: r.countdownUntil });
  };

  const revert = () => {
    const p = prePos.current; if (!p) return;
    const jump = (window as unknown as { __siegeJump?: (m: string, q: [number, number, number]) => void }).__siegeJump;
    if (preMap.current && preMap.current !== getActiveMapId() && jump) jump(preMap.current, [p.x, p.y, p.z]);  // back to the prior map + spot
    else camera.position.copy(p);
  };

  const stop = () => {
    r.active = false; r.countdownUntil = 0;
    if (lookSaveTimer.current) { clearTimeout(lookSaveTimer.current); lookSaveTimer.current = null; }
    exitLookContext();        // restore the global/world look — this challenge's mood was per-instance
    endSiegeIntro();          // tear down the spawn cinematic if the challenge is stopped mid-intro
    setSiegePlayerDead(false);
    setSiegeSpawnPin(null);   // release any spawn pin so the player isn't frozen after the challenge ends
    groundSnap.current = null;
    setMobs([]);
    revert();
    setChallengeState({ active: false, completed: false, announce: null, wave: 0, waveEndsAt: 0, countdownUntil: 0, result: null });
  };

  // Leave a finished challenge for free-roam (result panel Close / Choose Another): a lost player is a
  // ghost, so revive them to full health first, THEN tear the challenge down (clears the YOU LOSE panel,
  // the wandering monsters, and returns them to where they were before the challenge).
  const exit = () => { fireChallengeRevive(); stop(); };

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
      killedBy: outcome === 'lose' ? (getLastPlayerAttacker() || undefined) : undefined,
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
    setChallengeSkip(() => { if (r.active && r.countdownUntil) { r.countdownUntil = performance.now(); requestIntroBypass(); } });  // START NOW → also skip the cinematic countdown
    setChallengeExit(() => exit());   // result panel Close / Choose Another → revive + free-roam
    return () => { setChallengeToggle(null); setChallengeLose(null); setChallengeStart(null); setChallengeSkip(null); setChallengeExit(null); };
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
    if (groundSnap.current && !isSiegeIntroActive()) {
      // (Held off while the spawn cinematic owns the camera — it positions Y itself; groundSnap
      // resumes the instant the intro hands control back, still within its 30s window.)
      // The ground here is the baked MESH (no real heightmap), and 80+ collider meshes build in the
      // BACKGROUND — so the surface isn't ready for a moment after arrival. Cast from a FIXED ceiling
      // just above the intended spawn (NOT the live camera Y, which drops as the player falls — on a
      // high arena that dropped ceiling can no longer see the real ground above it, the bug that left
      // you stuck at the bottom). HOLD the player at the spawn until the mesh is ready instead of
      // letting them sink through to the lower terrain layer, then snap eye = ground + 1.6.
      const { ceil: gc, holdY, until } = groundSnap.current;
      const g = meshGroundHeight(camera.position.x, camera.position.z, gc)
             ?? groundAt(camera.position.x, camera.position.z, gc);
      // Only SETTLE onto ground that's actually near the authored spawn (the real floor at that height).
      // A surface far below (the lower terrain layer, which builds first) is rejected — keep the pin so
      // the player stays at the spawn until the right ground is ready. Time out so we never trap them.
      if (g != null && g + 1.6 >= holdY - 6) { camera.position.y = g + 1.6; groundSnap.current = null; setSiegeSpawnPin(null); }
      else if (now > until) { groundSnap.current = null; setSiegeSpawnPin(null); }
      // else: still pinned at the spawn Y by the controller — don't snap to the lower layer.
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

    // 2. Count this run's still-alive monsters (across all waves — carry-overs included). Wave
    // transitions aren't frame-sensitive, so throttle this O(n) scan to ~6×/s instead of every frame.
    if (now - r.lastAliveAt >= ALIVE_SCAN_MS) {
      const prefix = `chal${r.runId}_`;
      let a = 0;
      for (let i = 0; i < siegeDemons.length; i++) {
        const d = siegeDemons[i];
        if (!d.dead && d.id.indexOf(prefix) === 0) a++;
      }
      r.aliveCount = a; r.lastAliveAt = now;
    }
    const alive = r.aliveCount;
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
                        ballColor={s.ballColor} riseFromGround={s.rise} onDespawn={removeMob} />
      ))}
    </>
  );
}
