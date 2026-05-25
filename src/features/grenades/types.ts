import * as THREE from 'three';

export interface GrenadeInstance {
  id: string;
  tier: number; // 1..10
  /** Live world position. Mutated every frame by the physics tick. */
  position: THREE.Vector3;
  /** Live velocity. */
  velocity: THREE.Vector3;
  /** Spawn time (performance.now()/1000). Fuse fires fuseSec later. */
  spawnedAt: number;
  /** Fuse duration in seconds. */
  fuseSec: number;
  /** Throw direction yaw — kept so the visual sphere can spin during flight. */
  throwYaw: number;
  /** True once velocity has decayed enough that the grenade is rolling
   *  along the ground rather than ballistically bouncing. */
  isRolling: boolean;
  /** Set true after the explosion fires so the next tick removes us. */
  exploded: boolean;
}
