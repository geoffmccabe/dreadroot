// siegeCharLineupState — the toggleable character lineup (the Starblind characters). Toggled with
// "&&&", appears on the ground in front of the player in any SWW world. M/N cycle the shared
// animation (same Mixamo skeleton + clips on every character, so one index drives all). Each
// animation has a 1-based number for reference.
import { useSyncExternalStore } from 'react';

// Bump ONLY when the character/anim glbs are rebuilt — it's the cache key for those assets, kept
// separate from APP_VERSION so ordinary deploys don't force a re-download (they cache in the
// browser like an offline store). v2 = Draco meshes + shared animation library.
export const CHAR_ASSET_VERSION = '33';
// Shared Draco/clip libraries holding every animation — loaded once, applied to every character by
// bone name (all mixamorig). Adding a character costs ~0.6–0.9 MB; adding clips grows only these.
// Split by category so each is fetched independently and we can rebuild one without the others'
// source FBXs. The lineup loads ALL of them and merges the clips into one M/N cycle.
export const ANIM_LIBRARY = '/siege/characters/siege_anims.glb';
// 22 Mixamo rifle clips (idle/aim/walk/run/strafe/fire/turns/jumps/reloads/crawl), keyframe-reduced.
export const RIFLE_LIBRARY = '/siege/characters/siege_rifle_anims.glb';
// Unarmed ground locomotion, gender-prefixed (Loco_M_* / Loco_F_*): idle/walk/run/strafe/turn/jump.
export const LOCO_LIBRARY = '/siege/characters/siege_loco_anims.glb';

// scale brings each model to its real height; minY (glb-space feet) lets the renderer keep the
// scaled feet on the ground.  Ash → 2.0 m incl. hat (raw 1.783), Thorn → 1.4 m (raw 2.010).
// heightM = the character's KNOWN rendered height (m). Used to size the held gun proportionally —
// a live bounding box can't be trusted (it includes hats, hair, Ash's cigarette smoke, raised arms).
export interface LineupChar { name: string; file: string; scale: number; minY: number; heightM: number; }
// Character MESHES only (no embedded animations — those live in ANIM_LIBRARY).
// scale = targetHeight / rawHeight. Dago 2.4m (raw 1.695), Jankz 1.65m (raw 1.711), Rajax 1.75m (raw 1.926).
export const LINEUP_CHARS: LineupChar[] = [
  { name: 'Ash',   file: '/siege/characters/pilot_ash.glb',   scale: 1.122, minY: -0.0055, heightM: 2.0 },
  { name: 'Thorn', file: '/siege/characters/pilot_thorn.glb', scale: 0.697, minY: -0.2455, heightM: 1.4 },
  { name: 'Dago',  file: '/siege/characters/pilot_dago.glb',  scale: 1.298, minY: -0.0590, heightM: 2.2 },  // improved model (Dago5) — correct head + hands, 2.2m
  { name: 'Jankz', file: '/siege/characters/pilot_jankz.glb', scale: 0.965, minY: -0.0038, heightM: 1.65 },
  { name: 'Rajax', file: '/siege/characters/pilot_rajax.glb', scale: 1.140, minY: -0.0002, heightM: 1.75 },  // animated stance reads short; bumped to look 1.75m
  { name: 'Fluffer', file: '/siege/characters/pilot_fluffer.glb', scale: 1.181, minY: -0.0139, heightM: 2.3 }, // 2.3m — calibrated vs Dago(2.2m) by actual rendered height (POSITION bbox lies for skinned meshes)
];

export interface LineupAnchor { x: number; z: number; yaw: number; groundY: number }

let enabled = false;
let animIndex = 0;
let animNames: string[] = [];
let anchor: LineupAnchor | null = null;
let version = 0; // monotonic — getSnapshot returns this so React never misses a change
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };

export const getCharLineupEnabled = (): boolean => enabled;

export function toggleCharLineup(): void { enabled = !enabled; emit(); }
export function setCharAnchor(a: LineupAnchor): void { anchor = a; emit(); }
export function setCharAnimNames(n: string[]): void { if (n.length && n.length !== animNames.length) { animNames = n; emit(); } }
export function cycleCharAnim(dir: number): void {
  if (!animNames.length) return;
  animIndex = (animIndex + dir + animNames.length) % animNames.length; emit();
}

// Flight demo trigger: a counter the in-canvas characters poll each frame (no React re-render).
// F = glide then LAND, G = glide then stick to a WALL — to show the decision fork.
let flightSeq = 0;
let flightMode: 'land' | 'wall' = 'land';
export const getFlightSeq = (): number => flightSeq;
export const getFlightMode = (): 'land' | 'wall' => flightMode;
export function triggerFlight(mode: 'land' | 'wall'): void { flightMode = mode; flightSeq++; }

// Parkour demo (J): one counter that both selects the obstacle preset (seq % presetCount) and, when
// it changes, tells each character to run at it and auto-parkour. emit() so the obstacle box re-renders.
let parkourSeq = 0;
export const getParkourSeq = (): number => parkourSeq;
export function triggerParkour(): void { parkourSeq++; emit(); }

export function useCharLineup(): { enabled: boolean; animIndex: number; animNames: string[]; anchor: LineupAnchor | null; parkourSeq: number } {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => version, () => version);
  return { enabled, animIndex, animNames, anchor, parkourSeq };
}
