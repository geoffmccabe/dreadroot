import * as THREE from 'three';

export const CAMERA_START_X = -8;
export const CAMERA_START_Z = 22;

export const CHUNK_UPDATE_THROTTLE = 100; // ms

export const MAX_WISP_PARTICLES = 50;

export const MAX_BULLETS = 20;
export const BULLET_GRAVITY = 9.8; // m/s^2

export const BULLET_RENDER_THROTTLE = 50; // ms
export const WISP_RENDER_THROTTLE = 50; // ms

export type BulletLocal = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  velocityY: number;
  speed: number;
  life: number;
  tier: number;
  color: string;
  ricochetScale: number;
  isPentabullet: boolean;
};

export function calculateHitNormal(
  hitX: number,
  hitY: number,
  hitZ: number,
  blockX: number,
  blockY: number,
  blockZ: number
) {
  // Calculate which face of the block was hit based on hit position
  const localX = hitX - blockX;
  const localY = hitY - blockY;
  const localZ = hitZ - blockZ;

  // Find the dominant axis (closest to a face)
  const absX = Math.abs(localX);
  const absY = Math.abs(localY);
  const absZ = Math.abs(localZ);

  // Determine normal based on which axis has the largest displacement
  if (absX > absY && absX > absZ) {
    return { x: Math.sign(localX), y: 0, z: 0 };
  } else if (absY > absX && absY > absZ) {
    return { x: 0, y: Math.sign(localY), z: 0 };
  } else {
    return { x: 0, y: 0, z: Math.sign(localZ) };
  }
}
