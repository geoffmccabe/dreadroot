import { useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import * as THREE from 'three';

// Pre-allocated scratch for tracer calculation
const _scratchTracerEnd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);

import { MAX_BULLETS, type BulletLocal } from './fortressScene.constants';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

export function useFortressShooting({
  checkWispHit,
  selectedBulletTier,
  bulletPoolRef,
  activeBulletCount,
  bulletsRef,
  tracersRef,
  setBulletRenderTrigger,
  setShowCrosshairs,
  getDefinitionRef,
  camera,
  isSiege = false,
}: {
  checkWispHit: () => Promise<boolean>;
  selectedBulletTier: number;
  bulletPoolRef: MutableRefObject<BulletLocal[]>;
  activeBulletCount: MutableRefObject<number>;
  bulletsRef: MutableRefObject<BulletLocal[]>;
  tracersRef: MutableRefObject<any>;
  setBulletRenderTrigger: Dispatch<SetStateAction<number>>;
  setShowCrosshairs: Dispatch<SetStateAction<boolean>>;
  getDefinitionRef: MutableRefObject<(tier: number) => any>;
  camera: THREE.Camera;
  isSiege?: boolean;
}) {
  const handleShoot = useCallback((
    origin?: THREE.Vector3,
    direction?: THREE.Vector3,
    isPentabullet?: boolean
  ) => {
    // Capture origin and direction immediately. Default origin = local-player
    // canonical snapshot (post-L2 this is reconciled server position, not camera).
    let capturedOrigin: THREE.Vector3;
    if (origin) {
      capturedOrigin = origin.clone();
    } else {
      const snap = getLocalPlayerSnapshot();
      capturedOrigin = new THREE.Vector3(snap.x, snap.y, snap.z);
    }

    // Block firing inside Fortress Safe Zone — but ONLY in DreadRoot. Siege maps have no
    // fortress; the safe zone sits at the origin where Siege builder maps spawn, which was
    // silently blocking guns there.
    if (!isSiege && isPointInFSZ(capturedOrigin.x, capturedOrigin.y, capturedOrigin.z)) return;

    const capturedDirection = direction ? direction.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    capturedDirection.normalize();

    // Check wisp hit in background - don't block shooting
    checkWispHit();

    // Pull a bullet from pool or create new if pool empty
    let bullet: BulletLocal;
    if (bulletPoolRef.current.length > 0) {
      bullet = bulletPoolRef.current.pop()!;
    } else if (activeBulletCount.current < MAX_BULLETS) {
      // Create new bullet if under limit
      bullet = {
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        velocityY: 0,
        speed: 0,
        life: 0,
        tier: 1,
        color: '#ffaa00',
        ricochetScale: 1.0,
        isPentabullet: false,
      };
      activeBulletCount.current++;
    } else {
      return; // At max bullets
    }

    // Use the captured origin/direction from before the async call
    bullet.position.copy(capturedOrigin);
    bullet.direction.copy(capturedDirection);

    // Clear any stale tracer data from previous use
    (bullet as any).lastTracerPos = null;
    bullet.velocityY = bullet.direction.y * getDefinitionRef.current(selectedBulletTier).velocity;

    // Get tier definition for velocity and color
    const definition = getDefinitionRef.current(selectedBulletTier);
    bullet.speed = definition.velocity;
    bullet.life = 180;
    bullet.tier = selectedBulletTier;
    bullet.color = (definition.colors && definition.colors[0]) || '#ffaa00';
    bullet.ricochetScale = 1.0;
    bullet.isPentabullet = isPentabullet || definition.name === 'Pentabullet';

    // Add to active bullets
    bulletsRef.current.push(bullet);
    setBulletRenderTrigger((prev) => prev + 1);
    setShowCrosshairs(true);

    // Siege: draw the tracer as if from the gun MUZZLE (below/right/ahead of the eye), not the eye
    // centre. Physics still fires from the eye so aim stays exact; we only shift the tracer's visual
    // path by a constant offset (stored on the bullet, applied to every trail segment in the frame loop).
    let ox = 0, oy = 0, oz = 0;
    if (isSiege) {
      _muzzle.copy(bullet.direction).multiplyScalar(0.4);   // ahead of the eye along the aim
      _right.crossVectors(bullet.direction, _WORLD_UP).normalize();
      _muzzle.addScaledVector(_right, 0.12);                 // slightly toward the (right) gun hand
      _muzzle.y -= 0.2;                                       // and below the eye ≈ gun height
      ox = _muzzle.x; oy = _muzzle.y; oz = _muzzle.z;
      (bullet as any).tracerOffset = { x: ox, y: oy, z: oz };
    } else {
      (bullet as any).tracerOffset = null;
    }
    // Add initial tracer segment from the muzzle (or eye in DreadRoot)
    _scratchTracerEnd.copy(bullet.position).addScaledVector(bullet.direction, 2);
    tracersRef.current?.addSegment(
      bullet.position.x + ox, bullet.position.y + oy, bullet.position.z + oz,
      _scratchTracerEnd.x + ox, _scratchTracerEnd.y + oy, _scratchTracerEnd.z + oz,
      bullet.color
    );
  }, [
    checkWispHit,
    selectedBulletTier,
    bulletPoolRef,
    activeBulletCount,
    bulletsRef,
    tracersRef,
    setBulletRenderTrigger,
    setShowCrosshairs,
    getDefinitionRef,
    camera,
  ]);

  return { handleShoot };
}
