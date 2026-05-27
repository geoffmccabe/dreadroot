// Procedural concussion + flash layer for grenade explosions.
//
// Two-stage effect on top of the existing flame plumes:
//   1. A bright tier-colored flash sphere at the blast center,
//      additive-blended, lives ~140ms (briefer than a heartbeat).
//   2. An expanding shockwave ring on the horizontal plane,
//      growing from 0 to ~1.5× blast radius over 450ms, fading
//      alpha 1.0 → 0. Reads as the "concussion" radiating out.
//
// Both run on useFrame, no external asset, no licensing. Tier
// color matches grenadeColors() so the effect visually carries
// the grenade's identity.

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface ExplosionFXHandle {
  spawn: (position: THREE.Vector3, radius: number, color: string) => void;
}

interface Effect {
  startTime: number;
  flash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  radius: number; // target shockwave outer radius
}

const FLASH_DURATION = 0.14;     // seconds
const SHOCKWAVE_DURATION = 0.45; // seconds
const MAX_EFFECTS = 16;

// Reused geometries so each spawn doesn't allocate.
const _flashGeo = new THREE.SphereGeometry(1, 16, 12);
const _ringGeo = new THREE.RingGeometry(0.92, 1.0, 64); // thin annulus
_ringGeo.rotateX(-Math.PI / 2); // lay flat on XZ plane

export const ExplosionFX = forwardRef<ExplosionFXHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const effectsRef = useRef<Effect[]>([]);

  useImperativeHandle(ref, () => ({
    spawn: (position, radius, color) => {
      // Cap concurrent effects — eject the oldest if at the limit.
      if (effectsRef.current.length >= MAX_EFFECTS) {
        const oldest = effectsRef.current.shift();
        if (oldest) {
          scene.remove(oldest.flash);
          scene.remove(oldest.ring);
          oldest.flashMat.dispose();
          oldest.ringMat.dispose();
        }
      }

      const c = new THREE.Color(color);

      // Flash: bright sphere, additive, starts at ~30% of radius
      // and grows slightly while fading.
      const flashMat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const flash = new THREE.Mesh(_flashGeo, flashMat);
      flash.position.copy(position);
      flash.position.y += 0.3; // lift slightly off ground so it doesn't z-fight
      flash.scale.setScalar(radius * 0.35);
      scene.add(flash);

      // Shockwave: flat ring that expands outward. Starts very small,
      // grows to 1.5× radius, fades to 0 alpha.
      const ringMat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const ring = new THREE.Mesh(_ringGeo, ringMat);
      ring.position.copy(position);
      ring.position.y = Math.max(0.05, position.y); // sit just above ground
      ring.scale.setScalar(0.5);
      scene.add(ring);

      effectsRef.current.push({
        startTime: performance.now() / 1000,
        flash, flashMat, ring, ringMat,
        radius,
      });
    },
  }), [scene]);

  useFrame(() => {
    const now = performance.now() / 1000;
    const list = effectsRef.current;
    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const elapsed = now - e.startTime;
      const flashT = elapsed / FLASH_DURATION;
      const ringT = elapsed / SHOCKWAVE_DURATION;

      // Flash: scale slightly up while alpha falls 1 → 0.
      if (flashT < 1) {
        const fs = e.radius * (0.35 + flashT * 0.25);
        e.flash.scale.setScalar(fs);
        e.flashMat.opacity = 1 - flashT;
      } else if (e.flash.visible) {
        e.flash.visible = false;
        e.flashMat.opacity = 0;
      }

      // Shockwave: scale 0.5 → 1.5× radius, alpha 0.95 → 0.
      // Ease-out (1 - (1-t)^2) so it shoots out fast then slows.
      if (ringT < 1) {
        const eased = 1 - (1 - ringT) * (1 - ringT);
        const rs = e.radius * (0.5 + eased * 1.0); // ends at 1.5× radius
        e.ring.scale.setScalar(rs);
        e.ringMat.opacity = 0.95 * (1 - ringT);
      } else {
        // Done — clean up.
        scene.remove(e.flash);
        scene.remove(e.ring);
        e.flashMat.dispose();
        e.ringMat.dispose();
        continue;
      }
      list[writeIdx++] = e;
    }
    list.length = writeIdx;
  });

  return null;
});

ExplosionFX.displayName = 'ExplosionFX';
