import { useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import * as THREE from 'three';

import { MAX_BULLETS, type BulletLocal } from './fortressScene.constants';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';

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
}) {
  const handleShoot = useCallback((
    origin?: THREE.Vector3,
    direction?: THREE.Vector3,
    isPentabullet?: boolean
  ) => {
    // Capture origin and direction immediately
    const capturedOrigin = origin ? origin.clone() : camera.position.clone();

    // Block firing inside Fortress Safe Zone
    if (isPointInFSZ(capturedOrigin.x, capturedOrigin.y, capturedOrigin.z)) return;

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

    // Add initial tracer segment from camera position
    const tracerEnd = bullet.position.clone().addScaledVector(bullet.direction, 2);
    tracersRef.current?.addSegment(
      bullet.position.x, bullet.position.y, bullet.position.z,
      tracerEnd.x, tracerEnd.y, tracerEnd.z,
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
