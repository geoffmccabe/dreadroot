// charAnimDebug — diagnostics for the self-avatar's locomotion: WHICH clip is playing and the
// movement + terrain context that chose it (grounded, vertical speed, input, gap to the ground, a
// 3×3 height grid to reveal slope). The self-avatar writes here; the DFLOW panel shows it live and
// appends it to the COPY dump so pasting it gives a full picture of what the character is doing.

export interface CharSnap {
  t: number;
  clip: string;
  grounded: boolean; vy: number; mf: number; mr: number; run: boolean; gun: boolean;
  x: number; y: number; z: number; eyeH: number;
  groundTerrain: number | null;   // sampleHeight (heightfield)
  groundMesh: number | null;      // mesh-collider ground under the player
  grid: (number | null)[];        // 3×3 sampleHeight around the player (0.5 m), row-major
  /** Which movement state the selector picked (idle/walkF/jump/fall/…). */
  state?: string;
  /** The parkour move owning the body, or null. Without this a climb and a
   *  jump look identical in the log, which is the exact confusion this whole
   *  readout exists to end. */
  move?: string | null;
}

let current: CharSnap | null = null;
interface Evt { from: string; to: string; snap: CharSnap; }
const events: Evt[] = [];
const MAX_EVENTS = 40;

export function setCharSnap(s: CharSnap): void { current = s; }
export function pushCharAnimEvent(from: string, to: string, snap: CharSnap): void {
  events.push({ from, to, snap });
  while (events.length > MAX_EVENTS) events.shift();
}
export function getCharSnap(): CharSnap | null { return current; }

const f2 = (n: number | null | undefined) => (n == null ? 'null' : n.toFixed(2));
function groundOf(s: CharSnap): number | null { return s.groundMesh ?? s.groundTerrain; }
function gapOf(s: CharSnap): number | null { const g = groundOf(s); return g == null ? null : (s.y - s.eyeH) - g; }

/** One-line summary for the live panel. */
export function charAnimLine(): string {
  const s = current; if (!s) return 'anim: (no data)';
  return `${s.clip.replace(/Anim_Rifle_|_NoSkin/g, '')} | ${s.state ?? '?'}${s.move ? ` | PARKOUR ${s.move}` : ''} | grnd=${s.grounded ? 'Y' : 'N'} vy=${f2(s.vy)} gap=${f2(gapOf(s))} mf=${s.mf} mr=${s.mr}${s.run ? ' run' : ''}`;
}

/** Full dump appended to the DFLOW COPY. */
export function charAnimExport(): string {
  if (!current) return '=== CHARACTER ANIMATION ===\n(no data — the self-avatar has not rendered a frame yet)';
  const s = current;
  const grid = s.grid.length
    ? [0, 1, 2].map((r) => '    ' + [0, 1, 2].map((c) => f2(s.grid[r * 3 + c]).padStart(7)).join(' ')).join('\n')
    : '    (voxel world — no heightfield)';
  let out = '=== CHARACTER ANIMATION DIAGNOSTICS ===\n';
  out += `CURRENT: clip=${s.clip}\n`;
  out += `  state=${s.state ?? '?'}   parkour=${s.move ?? 'none'}\n`;
  out += `  grounded=${s.grounded} vy=${f2(s.vy)} mf=${s.mf} mr=${s.mr} run=${s.run} gun=${s.gun}\n`;
  out += `  feetY=${f2(s.y - s.eyeH)} groundTerrain=${f2(s.groundTerrain)} groundMesh=${f2(s.groundMesh)} gapToGround=${f2(gapOf(s))}\n`;
  out += `  pos=(${f2(s.x)}, ${f2(s.y)}, ${f2(s.z)})\n`;
  out += `  heightGrid (0.5 m spacing, sampleHeight):\n${grid}\n`;
  if (events.length) {
    out += '\nRECENT CLIP CHANGES (newest last):\n';
    for (const e of events) {
      const es = e.snap;
      out += `  ${e.from.replace(/Anim_Rifle_|_NoSkin/g, '')} → ${e.to.replace(/Anim_Rifle_|_NoSkin/g, '')}\n`;
      out += `      y=${f2(es.y)} vy=${f2(es.vy)} grnd=${es.grounded ? 'Y' : 'N'} state=${es.state ?? '?'} parkour=${es.move ?? 'none'}\n`;
    }
  }
  return out;
}
