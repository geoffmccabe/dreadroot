import * as THREE from 'three';

/**
 * Live thrown shpider egg. Mirrors GrenadeInstance shape but with a
 * "rest timer" instead of a fuse — hatches when it stops moving
 * instead of on a countdown.
 */
export interface ShpiderEggInstance {
  id: string;
  /** 1..10. Determines spawned shpider tier. */
  tier: number;
  /** Inventory row this egg was consumed from. Used to refund the
   *  same row (with cooldown) when the hatched shpider dies. */
  eggInventoryRowId: string;
  /** Live world position. Mutated each frame by the physics tick. */
  position: THREE.Vector3;
  /** Live velocity. */
  velocity: THREE.Vector3;
  /** Spawn time (performance.now()/1000). */
  spawnedAt: number;
  /** Seconds the egg has been "at rest" (speed under threshold).
   *  Once this exceeds REST_HATCH_SEC the egg hatches. */
  restAccumSec: number;
  /** Set true after hatch fires so the next tick removes us. */
  hatched: boolean;
}
