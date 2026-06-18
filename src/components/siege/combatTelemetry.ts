// combatTelemetry — a lightweight, copy-to-clipboard combat recorder for diagnosing
// "it hit me but looked too far away" problems. It answers two questions the player
// cares about: TIMING (when did a hit land) and SPACING (how far was the attacker at
// the moment of impact, vs its attack range + hitbox radius).
//
// Data sources (all already live, zero new plumbing):
//   • siegeDemons[]  — every monster's world position, hp, hitbox radius (siegeHorde.ts)
//   • the player camera position (fed in by the R3F probe each frame)
//   • dealPlayerDamage() — the single hub every melee/spray hit routes through
//
// The probe (CombatTelemetryProbe, R3F) calls recordSnapshot() ~10×/sec with the player
// position; it keeps `live` (nearest monster, player hp) fresh so recordHit() — called
// from dealPlayerDamage(), OUTSIDE react — can stamp each hit with the spacing at impact.
import { siegeDemons } from './siegeHorde';
import { getPlayerHealthSnapshot } from '@/features/shwarm/hooks/usePlayerHealth';

export interface NearMon { id: string; dist: number; range: number; radius: number; hp: number; }
interface HitRec { t: number; kind: 'hit'; dmg: number; kb: number; hp: number; dist: number; range: number; radius: number; }
interface SnapRec { t: number; kind: 'snap'; hp: number; mon: NearMon[]; }
type Rec = HitRec | SnapRec;

const MAX = 6000;            // ring buffer cap (~10 min at 10Hz snapshots)
const SNAP_MS = 100;         // snapshot cadence
const NEAR_RANGE = 60;       // only log monsters within this many metres of the player

const buf: Rec[] = [];
let startT = 0;              // performance.now() of the first record
let lastSnap = 0;
let paused = false;

// Kept fresh by the probe so recordHit (called from non-react damage code) can stamp spacing.
const live = {
  px: 0, py: 0, pz: 0,
  hp: 0,
  nearest: { id: '-', dist: 999, range: 0, radius: 0, hp: 0 } as NearMon,
  monCount: 0,
};

// ---- subscription (for the overlay's live readout) ----
const subs = new Set<() => void>();
function emit() { subs.forEach((f) => f()); }
export function subscribeTelemetry(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function getTelemetryLive() { return live; }
export function isTelemetryPaused() { return paused; }
export function getTelemetryCount() { return buf.length; }

export function setTelemetryPaused(v: boolean) { paused = v; emit(); }
export function toggleTelemetryPaused() { paused = !paused; emit(); }
export function clearTelemetry() { buf.length = 0; startT = 0; lastSnap = 0; emit(); }

function stamp(): number {
  const now = performance.now();
  if (startT === 0) startT = now;
  return now - startT;
}

/** Called by the R3F probe each frame with the player (camera) position. */
export function recordSnapshot(px: number, py: number, pz: number) {
  live.px = px; live.py = py; live.pz = pz;
  live.hp = getPlayerHealthSnapshot();

  // Find the nearest live monster + collect those within NEAR_RANGE.
  let nearest: NearMon = { id: '-', dist: 9999, range: 0, radius: 0, hp: 0 };
  const near: NearMon[] = [];
  for (let i = 0; i < siegeDemons.length; i++) {
    const d = siegeDemons[i];
    if (d.dead) continue;
    const dx = d.x - px, dz = d.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > NEAR_RANGE) continue;
    const nm: NearMon = { id: d.id, dist, range: 0, radius: d.radius, hp: d.hp };
    near.push(nm);
    if (dist < nearest.dist) nearest = nm;
  }
  live.nearest = nearest;
  live.monCount = near.length;

  if (paused) return;
  const t = stamp();
  if (t - lastSnap >= SNAP_MS) {
    lastSnap = t;
    near.sort((a, b) => a.dist - b.dist);
    buf.push({ t, kind: 'snap', hp: live.hp, mon: near.slice(0, 6) });
    if (buf.length > MAX) buf.shift();
    emit();
  }
}

/** Called from dealPlayerDamage() the instant a hit lands on the player. */
export function recordHit(dmg: number, kb: number) {
  if (paused) return;
  const n = live.nearest;
  buf.push({ t: stamp(), kind: 'hit', dmg, kb, hp: live.hp, dist: n.dist, range: n.range, radius: n.radius });
  if (buf.length > MAX) buf.shift();
  emit();
}

/** Render the whole sequence as a human + AI readable text report for copy/paste. */
export function formatTelemetry(): string {
  if (buf.length === 0) return 'No combat data recorded yet.';
  const dur = (buf[buf.length - 1].t / 1000).toFixed(1);
  const hits = buf.filter((r): r is HitRec => r.kind === 'hit');
  const totalDmg = hits.reduce((s, h) => s + h.dmg, 0);
  const lines: string[] = [];
  lines.push(`=== DREADROOT COMBAT LOG ===`);
  lines.push(`duration: ${dur}s   records: ${buf.length}   hits: ${hits.length}   total damage: ${Math.round(totalDmg)}`);
  lines.push(`columns: time(s) | event`);
  lines.push(`hit row:  HP after | damage | knockback | attacker distance | attacker hitbox radius`);
  lines.push(`snap row: HP | nearest monsters as id@dist(r=radius,hp)`);
  lines.push(``);
  for (const r of buf) {
    const ts = (r.t / 1000).toFixed(2).padStart(7);
    if (r.kind === 'hit') {
      const tooFar = r.dist > r.radius + 1.5 ? '  <-- HIT FROM FAR' : '';
      lines.push(`${ts}  HIT   hp=${Math.round(r.hp)} dmg=${r.dmg.toFixed(1)} kb=${r.kb.toFixed(1)} dist=${r.dist.toFixed(2)}m radius=${r.radius.toFixed(2)}m${tooFar}`);
    } else {
      const mon = r.mon.map((m) => `${m.id.slice(-4)}@${m.dist.toFixed(1)}(r${m.radius.toFixed(1)},hp${Math.round(m.hp)})`).join(' ');
      lines.push(`${ts}  snap  hp=${Math.round(r.hp)} [${r.mon.length}] ${mon}`);
    }
  }
  return lines.join('\n');
}

export async function copyTelemetry(): Promise<boolean> {
  const text = formatTelemetry();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
