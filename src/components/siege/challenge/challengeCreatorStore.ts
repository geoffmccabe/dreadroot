// challengeCreatorStore — state for the Challenge EDITOR. "!e" opens the editor GALLERY (the creator's
// OWN challenges as cards + a "New" card); picking one opens the full Creator panel loaded with that
// challenge. Two layers — the gallery (picker) and the creator (the editor) — one shown at a time.
import type { ChallengeRow } from './challengeStorage';

// ── Creator (the full editor panel) ──
let open = false;
const listeners = new Set<() => void>();
export function isCreatorOpen() { return open; }
export function subscribeCreator(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function setCreatorOpen(v: boolean) { open = v; listeners.forEach((l) => l()); }

// What the creator should load when it next opens: a saved row to edit, 'new' for a blank, or null to
// keep its current challenge. Set by the gallery, consumed ONCE by the panel on open.
let pendingEdit: ChallengeRow | 'new' | null = null;
export function openCreatorWith(target: ChallengeRow | 'new') { pendingEdit = target; setCreatorOpen(true); }
export function consumePendingEdit(): ChallengeRow | 'new' | null { const p = pendingEdit; pendingEdit = null; return p; }

// ── Gallery (the !e entry: pick which of YOUR challenges to edit, or make a new one) ──
let gallery = false;
const gListeners = new Set<() => void>();
export function isGalleryOpen() { return gallery; }
export function subscribeGallery(cb: () => void): () => void { gListeners.add(cb); return () => { gListeners.delete(cb); }; }
export function setGalleryOpen(v: boolean) { gallery = v; gListeners.forEach((l) => l()); }

// "!e": back out of the editor to the gallery if the editor is open; otherwise toggle the gallery.
export function toggleEditor() {
  if (open) { setCreatorOpen(false); setGalleryOpen(true); return; }
  setGalleryOpen(!gallery);
}
