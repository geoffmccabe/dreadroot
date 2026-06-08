// Reusable "enemy hit the ground" impact sound — for any enemy that gets
// thrown by a blast or drops off a tree and lands hard. 3D-spatial + distance
// falloff, with randomized pitch (±~50% via detune) AND speed (±20% via
// playbackRate) so it never sounds exactly the same twice. Shared by the
// shombie/shroomer adapters and the shpider system.
import { playSpatialSound, preloadSpatialSounds } from '@/lib/spatialAudio';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

const GROUND_IMPACT_URL = '/enemy_hitting_ground.mp3';
preloadSpatialSounds([GROUND_IMPACT_URL]);

// Minimum downward speed (m/s) to count as a real impact — filters out walking,
// small hops, and gravity settle so only blast-falls / tree-drops trigger it.
export const GROUND_IMPACT_MIN_SPEED = 6;

let _count = 0;
const MAX_CONCURRENT = 6;

export function playGroundImpact(ex: number, ey: number, ez: number, volume = 0.8): void {
  if (_count >= MAX_CONCURRENT) return;
  const p = getLocalPlayerSnapshot();
  const dx = ex - p.x, dy = ey - p.y, dz = ez - p.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  _count++;
  playSpatialSound(GROUND_IMPACT_URL, dist, {
    baseVolume: volume,
    playbackRate: 0.8 + Math.random() * 0.4,  // ±20% speed (also nudges pitch)
    detune: (Math.random() * 2 - 1) * 600,     // ±600 cents ≈ ±~40% pitch
  });
  setTimeout(() => { _count--; }, 400);
}
