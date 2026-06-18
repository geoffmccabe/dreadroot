// damageNumbers — floating combat damage popups, ported 1:1 from the Unity Siege Worlds
// FloatingDamageText: a billboarded number that pops in (OutBack overshoot), drifts up + sideways,
// holds then fades, ~1s life. White = normal hit, red = headshot, yellow = "Bullseye!".
// (Bullseye isn't wired in-game yet — spawnBullseye() is ready for when it is.)
export interface DamageNumber {
  id: number; x: number; y: number; z: number;
  text: string; color: string; born: number;
  speed: number;   // rise speed (m/s), Unity Random(1, 3.5)
  driftX: number;  // sideways drift sign, Unity Random(-1, 1)
}

export const DN_WHITE = '#ffffff';
export const DN_RED = '#ff3838';
export const DN_YELLOW = '#ffe23a';
export const DN_LIFE_MS = 1000;

const list: DamageNumber[] = [];
let _id = 0;
let version = 0;
const subs = new Set<() => void>();
function emit() { version++; subs.forEach((f) => f()); }

export function getDamageNumbers(): DamageNumber[] { return list; }
export function getDNVersion(): number { return version; }
export function subscribeDamageNumbers(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

export function spawnDamageNumber(x: number, y: number, z: number, text: string, color = DN_WHITE): void {
  list.push({ id: _id++, x, y, z, text, color, born: performance.now(), speed: 1 + Math.random() * 2.5, driftX: Math.random() * 2 - 1 });
  if (list.length > 80) list.splice(0, list.length - 80);   // cap so a horde can't flood
  emit();
}
/** Ready for when bullseye targets exist — yellow "Bullseye!" popup. */
export function spawnBullseye(x: number, y: number, z: number): void {
  spawnDamageNumber(x, y, z, 'Bullseye!', DN_YELLOW);
}

export function pruneDamageNumbers(now: number): void {
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (now - list[i].born > DN_LIFE_MS + 150) { list.splice(i, 1); changed = true; }
  }
  if (changed) emit();
}
