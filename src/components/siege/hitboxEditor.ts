// In-world hitbox editor state. Active only while monsters are frozen (PPP) AND
// boxes are shown (!hb). Edits the box of the monster TYPE nearest the camera, so
// you just walk up to the monster you want and adjust. Per-axis move/resize in
// 0.05m steps; auto-saved (setHitboxAbsolute normalizes ÷height + persists).
//
// Keys (handled in SiegeSpawner, edit-mode only):
//   j/l  move ∓X (left/right)    u/o  move ∓Z (back/forward)   i/k  move ±Y (up/down)
//   Shift+same → grow/shrink the half-extent on that axis
//   b → toggle body/head box   n → reset this monster to default   ! h b x → export
import { getHitboxFor, setHitboxAbsolute, resetHitboxFor, type MonsterHitbox } from './hitboxConfig';

interface Editable {
  url: string; radius: number; height: number; headFrac: number;
  pos: () => { x: number; z: number };
}

const editables = new Set<Editable>();
export function registerEditable(e: Editable): () => void { editables.add(e); return () => { editables.delete(e); }; }

let selectedBox: 'body' | 'head' = 'head';
let editUrl: string | null = null;   // monster type currently being edited (for highlight)
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function subscribeEditor(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

export function getSelectedBox(): 'body' | 'head' { return selectedBox; }
export function getEditUrl(): string | null { return editUrl; }
export function toggleSelectedBox(): void { selectedBox = selectedBox === 'head' ? 'body' : 'head'; emit(); }

const STEP = 0.05;   // metres per key press

function nearest(camX: number, camZ: number): Editable | null {
  let best: Editable | null = null, bestD = Infinity;
  for (const e of editables) {
    const p = e.pos();
    const d = (p.x - camX) ** 2 + (p.z - camZ) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/** Move or resize the selected box of the nearest monster. axis in the monster's
 *  LOCAL frame: 'x' right, 'y' up, 'z' forward. resize → adjust half-extent. */
export function applyEdit(camX: number, camZ: number, axis: 'x' | 'y' | 'z', dir: 1 | -1, resize: boolean): void {
  const e = nearest(camX, camZ);
  if (!e) return;
  const hb: MonsterHitbox = getHitboxFor(e.url, e.radius, e.height, e.headFrac);
  // Clone so we never mutate a shared default object in place.
  const next: MonsterHitbox = { body: { ...hb.body }, head: { ...hb.head } };
  const box = selectedBox === 'head' ? next.head : next.body;
  const d = dir * STEP;
  if (resize) {
    if (axis === 'x') box.hx = Math.max(0.02, box.hx + d);
    else if (axis === 'y') box.hy = Math.max(0.02, box.hy + d);
    else box.hz = Math.max(0.02, box.hz + d);
  } else {
    if (axis === 'x') box.lx += d;
    else if (axis === 'y') box.ly += d;
    else box.lz += d;
  }
  editUrl = e.url;
  setHitboxAbsolute(e.url, next, e.height);   // store normalized (÷height) + notify renderers
  emit();
}

export function resetNearest(camX: number, camZ: number): void {
  const e = nearest(camX, camZ);
  if (!e) return;
  editUrl = e.url;
  resetHitboxFor(e.url);
  emit();
}

export function markEditTarget(camX: number, camZ: number): void {
  const e = nearest(camX, camZ);
  editUrl = e ? e.url : null;
  emit();
}
