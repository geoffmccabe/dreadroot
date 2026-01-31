import React, { useRef } from 'react';
import * as THREE from 'three';

import type { WispParticle } from './FortressTypes';

// Wisp particles using InstancedMesh for performance (no React re-renders per particle)
const MAX_WISP_PARTICLES = 50;
const wispParticleGeometry = new THREE.SphereGeometry(0.1, 8, 8);
const wispParticleMaterial = new THREE.MeshBasicMaterial({ transparent: true });
const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();

export interface WispParticlesMeshHandle {
  update: () => void;
}

export const WispParticlesMesh = React.forwardRef<WispParticlesMeshHandle, { particles: WispParticle[]; renderTrigger: number }>(
  ({ particles, renderTrigger }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);

    // Expose update function instead of using useFrame
    React.useImperativeHandle(ref, () => ({
      update: () => {
        if (!meshRef.current || particles.length === 0) {
          if (meshRef.current) meshRef.current.count = 0;
          return;
        }

        let count = 0;
        for (const particle of particles) {
          if (count >= MAX_WISP_PARTICLES) break;

          const scale = particle.scale ?? 1.0;
          tempMatrix.makeScale(scale, scale, scale);
          tempMatrix.setPosition(particle.position.x, particle.position.y, particle.position.z);
          meshRef.current.setMatrixAt(count, tempMatrix);

          tempColor.set(particle.color);
          meshRef.current.setColorAt(count, tempColor);

          count++;
        }

        meshRef.current.count = count;
        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
          meshRef.current.instanceColor.needsUpdate = true;
        }
      }
    }), [particles]);

    return (
      <instancedMesh
        ref={meshRef}
        args={[wispParticleGeometry, wispParticleMaterial, MAX_WISP_PARTICLES]}
        frustumCulled={false}
      />
    );
  }
);

WispParticlesMesh.displayName = 'WispParticlesMesh';
