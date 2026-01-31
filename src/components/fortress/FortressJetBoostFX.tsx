/**
 * FortressJetBoostFX - Particle effect for jet boost activation
 *
 * Renders two inverted fire plumes at the player's feet when jet boost is activated.
 * Uses simple point sprites with additive blending for a fire-like effect.
 */

import React, { useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Constants
const MAX_ACTIVE_BOOSTS = 4; // Max concurrent boost effects
const PARTICLES_PER_PLUME = 30;
const PARTICLES_PER_BOOST = PARTICLES_PER_PLUME * 2; // Two plumes per boost
const TOTAL_PARTICLES = MAX_ACTIVE_BOOSTS * PARTICLES_PER_BOOST;
const BOOST_DURATION = 1.0; // seconds
const PLUME_SPACING = 0.5; // 0.5m left/right = 1m apart total

interface BoostInstance {
  startTime: number;
  position: THREE.Vector3;
  colors: string[];
  active: boolean;
}

export interface JetBoostFXHandle {
  spawnJetBoost: (position: THREE.Vector3, colors: string[]) => void;
}

interface Props {
  getDefinition?: (tier: number) => { colors: string[] };
  bulletTier?: number;
}

export const FortressJetBoostFX = forwardRef<JetBoostFXHandle, Props>(
  ({ getDefinition, bulletTier = 1 }, ref) => {
    const pointsRef = useRef<THREE.Points>(null);
    const boostsRef = useRef<BoostInstance[]>([]);

    // Pre-allocate particle data
    const { positions, colors, sizes, geometry } = useMemo(() => {
      const positions = new Float32Array(TOTAL_PARTICLES * 3);
      const colors = new Float32Array(TOTAL_PARTICLES * 3);
      const sizes = new Float32Array(TOTAL_PARTICLES);

      // Initialize all particles far away
      for (let i = 0; i < TOTAL_PARTICLES; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -1000;
        positions[i * 3 + 2] = 0;
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0.5;
        colors[i * 3 + 2] = 0;
        sizes[i] = 0;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      return { positions, colors, sizes, geometry };
    }, []);

    // Shader material for fire-like particles
    const material = useMemo(() => {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
        },
        vertexShader: `
          attribute float size;
          attribute vec3 color;
          varying vec3 vColor;
          varying float vSize;
          void main() {
            vColor = color;
            vSize = size;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vSize;
          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            float alpha = 1.0 - (dist * 2.0);
            alpha = pow(alpha, 1.5);
            gl_FragColor = vec4(vColor, alpha * 0.8);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }, []);

    // Spawn a new jet boost effect
    const spawnJetBoost = (position: THREE.Vector3, tierColors: string[]) => {
      // Get colors from tier definition if available
      let effectColors = tierColors;
      if ((!effectColors || effectColors.length === 0) && getDefinition) {
        const def = getDefinition(bulletTier);
        effectColors = def?.colors || ['#FF6600', '#FF3300', '#FF0000'];
      }
      if (!effectColors || effectColors.length === 0) {
        effectColors = ['#FF6600', '#FF3300', '#FF0000'];
      }

      // Find an inactive slot or reuse oldest
      let slot = boostsRef.current.findIndex(b => !b.active);
      if (slot === -1) {
        // All slots used, reuse oldest
        let oldest = 0;
        let oldestTime = Infinity;
        boostsRef.current.forEach((b, i) => {
          if (b.startTime < oldestTime) {
            oldestTime = b.startTime;
            oldest = i;
          }
        });
        slot = oldest;
      }

      // Ensure slot exists
      if (!boostsRef.current[slot]) {
        boostsRef.current[slot] = {
          startTime: 0,
          position: new THREE.Vector3(),
          colors: [],
          active: false,
        };
      }

      boostsRef.current[slot].startTime = performance.now() / 1000;
      boostsRef.current[slot].position.copy(position);
      boostsRef.current[slot].colors = effectColors;
      boostsRef.current[slot].active = true;
    };

    useImperativeHandle(ref, () => ({
      spawnJetBoost,
    }));

    // Update particles each frame
    useFrame(() => {
      if (!pointsRef.current) return;

      const now = performance.now() / 1000;
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
      const sizeAttr = geometry.getAttribute('size') as THREE.BufferAttribute;

      let particleIndex = 0;

      // Process each boost
      for (let boostIdx = 0; boostIdx < MAX_ACTIVE_BOOSTS; boostIdx++) {
        const boost = boostsRef.current[boostIdx];
        const baseParticle = boostIdx * PARTICLES_PER_BOOST;

        if (!boost || !boost.active) {
          // Hide all particles for this boost
          for (let i = 0; i < PARTICLES_PER_BOOST; i++) {
            sizeAttr.array[baseParticle + i] = 0;
          }
          continue;
        }

        const elapsed = now - boost.startTime;
        if (elapsed > BOOST_DURATION) {
          boost.active = false;
          for (let i = 0; i < PARTICLES_PER_BOOST; i++) {
            sizeAttr.array[baseParticle + i] = 0;
          }
          continue;
        }

        const progress = elapsed / BOOST_DURATION;
        const fadeOut = 1.0 - progress;

        // Parse colors
        const color1 = new THREE.Color(boost.colors[0] || '#FF6600');
        const color2 = new THREE.Color(boost.colors[1] || boost.colors[0] || '#FF3300');

        // Update particles for two plumes (left and right)
        for (let plumeIdx = 0; plumeIdx < 2; plumeIdx++) {
          const xOffset = plumeIdx === 0 ? -PLUME_SPACING : PLUME_SPACING;

          for (let i = 0; i < PARTICLES_PER_PLUME; i++) {
            const pIdx = baseParticle + plumeIdx * PARTICLES_PER_PLUME + i;

            // Particle travels downward (inverted fire)
            const particleProgress = (i / PARTICLES_PER_PLUME + progress) % 1.0;
            const yOffset = -particleProgress * 1.5; // 1.5m plume length

            // Spread increases as particles move down
            const spread = particleProgress * 0.3;
            const angle = (i / PARTICLES_PER_PLUME) * Math.PI * 2 + elapsed * 5;
            const xSpread = Math.cos(angle) * spread;
            const zSpread = Math.sin(angle) * spread;

            posAttr.array[pIdx * 3] = boost.position.x + xOffset + xSpread;
            posAttr.array[pIdx * 3 + 1] = boost.position.y + yOffset;
            posAttr.array[pIdx * 3 + 2] = boost.position.z + zSpread;

            // Color blend based on particle position
            const colorMix = particleProgress;
            const r = color1.r * (1 - colorMix) + color2.r * colorMix;
            const g = color1.g * (1 - colorMix) + color2.g * colorMix;
            const b = color1.b * (1 - colorMix) + color2.b * colorMix;

            colorAttr.array[pIdx * 3] = r;
            colorAttr.array[pIdx * 3 + 1] = g;
            colorAttr.array[pIdx * 3 + 2] = b;

            // Size based on position and fade
            const baseSize = 0.5 + (1 - particleProgress) * 0.5; // Larger at top
            sizeAttr.array[pIdx] = baseSize * fadeOut;
          }
        }
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    });

    return (
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    );
  }
);

FortressJetBoostFX.displayName = 'FortressJetBoostFX';
