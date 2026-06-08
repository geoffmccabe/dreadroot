// Plays a random per-species "strike" swing sound, 3D-spatial + distance
// falloff, at the moment an enemy begins its strike (so the swing's arc lines
// up with the wind-up → thrust). Throttled module-wide so a horde all swinging
// doesn't stack into noise. Shared by every striking enemy adapter.
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

let _count = 0;
const MAX_CONCURRENT = 6;

export function preloadStrikeSounds(urls: readonly string[]): void {
  preloadSpatialSounds([...urls]);
}

export function playStrikeSound(
  urls: readonly string[],
  ex: number,
  ey: number,
  ez: number,
  volume = 0.8,
): void {
  if (_count >= MAX_CONCURRENT || urls.length === 0) return;
  const url = urls[Math.floor(Math.random() * urls.length)];
  const p = getLocalPlayerSnapshot();
  const dx = ex - p.x, dy = ey - p.y, dz = ez - p.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  _count++;
  playSpatialSound(url, dist, { baseVolume: volume });
  setTimeout(() => { _count--; }, 400);
}
