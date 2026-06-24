// siegeCorpses — corpse "wade zones". A dead monster's body should NOT block movement (piles of
// bodies were jamming the player AND the live monsters, making them sitting ducks). Instead of a
// blocking collider, a settled corpse registers its low footprint here; the player and monsters can
// flow straight over it, just at HALF horizontal speed while clambering across (so it still reads as
// stepping over a body). Zones are removed when the corpse despawns (challenge end / unmount).
import * as THREE from 'three';

const zones = new Set<THREE.Box3>();

export function addCorpseZone(b: THREE.Box3): void { zones.add(b); }
export function removeCorpseZone(b: THREE.Box3): void { zones.delete(b); }

/** 0.5 while standing over any corpse footprint, else 1. Cheap AABB scan (corpse counts are modest). */
export function corpseSlow(x: number, z: number): number {
  if (zones.size === 0) return 1;
  for (const b of zones) {
    if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) return 0.5;
  }
  return 1;
}
