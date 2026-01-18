import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { SHWARM_BLOCK_SIZE, DEFAULT_SHWARM_COLOR, MAX_SHWARM_BLOCKS } from '../constants';
import type { ShwarmInstance } from '../hooks/useShwarmSystem';
import { frameLoop } from '@/lib/frameLoop';

// Pre-allocated objects for InstancedMesh updates
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();

// Shared geometry for all shwarm blocks (0.5 size)
const shwarmBlockGeometry = new THREE.BoxGeometry(
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE
);

// Particle geometry (small squares - larger for visibility)
const particleGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);

// Maximum particles for hit effects
const MAX_HIT_PARTICLES = 200;

// Particle interface
interface HitParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  opacity: number;
  scale: number;
  active: boolean;
  color: THREE.Color;
}

export interface ShwarmRendererHandle {
  update: () => void;
  getMesh: () => THREE.InstancedMesh | null;
  createHitEffect: (position: THREE.Vector3, color?: number) => void;
}

interface ShwarmRendererProps {
  shwarms: ShwarmInstance[];
}

/**
 * Renders all shwarm blocks using InstancedMesh for performance
 * Also renders hit particles when shwarms are damaged
 * Exposes update() for frame loop integration (no useFrame)
 */
export const ShwarmRenderer = forwardRef<ShwarmRendererHandle, ShwarmRendererProps>(
  ({ shwarms }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const particleMeshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

    // Create material once
    const material = useMemo(() => {
      const mat = new THREE.MeshStandardMaterial({
        color: DEFAULT_SHWARM_COLOR,
        roughness: 0.5,
        metalness: 0.2,
      });
      materialRef.current = mat;
      return mat;
    }, []);

    // Create particle material
    const particleMaterial = useMemo(() => {
      return new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 1,
      });
    }, []);

    // Pre-allocate particles
    const particles = useMemo<HitParticle[]>(() => {
      const arr: HitParticle[] = [];
      for (let i = 0; i < MAX_HIT_PARTICLES; i++) {
        arr.push({
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          opacity: 0,
          scale: 0.08,
          active: false,
          color: new THREE.Color(0xff4444),
        });
      }
      return arr;
    }, []);

    // Create hit particle effect at position - spray of small squares like coin explosions
    const createHitEffect = (position: THREE.Vector3, color: number = DEFAULT_SHWARM_COLOR) => {
      const particleCount = 20; // More particles for better effect
      let spawned = 0;

      for (let i = 0; i < particles.length && spawned < particleCount; i++) {
        const particle = particles[i];
        if (!particle.active) {
          // Spherical distribution - radial burst
          const angle = (Math.PI * 2 * spawned) / particleCount + Math.random() * 0.3;
          const elevation = (Math.random() - 0.2) * Math.PI * 0.6;
          const speed = 5 + Math.random() * 6; // Faster for more punch

          particle.active = true;
          particle.position.copy(position);
          particle.velocity.set(
            Math.cos(angle) * Math.cos(elevation) * speed,
            Math.sin(elevation) * speed + 3, // bias upward
            Math.sin(angle) * Math.cos(elevation) * speed
          );
          particle.opacity = 1;
          particle.scale = 0.12 + Math.random() * 0.1; // Larger particles
          particle.color.setHex(color);
          spawned++;
        }
      }
    };

    // Register particle updates with frame loop
    useEffect(() => {
      const unregister = frameLoop.register('shwarmParticles', (delta) => {
        const particleMesh = particleMeshRef.current;
        if (!particleMesh) return;

        let activeCount = 0;
        const gravity = 15;

        for (const particle of particles) {
          if (!particle.active) continue;

          // Update position
          particle.position.addScaledVector(particle.velocity, delta);
          
          // Apply gravity
          particle.velocity.y -= gravity * delta;
          
          // Fade out
          particle.opacity -= delta * 2.5;

          if (particle.opacity <= 0 || particle.position.y <= 0) {
            particle.active = false;
            continue;
          }

          // Set matrix
          tmpPosition.copy(particle.position);
          tmpScale.set(particle.scale, particle.scale, particle.scale);
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
          particleMesh.setMatrixAt(activeCount, tmpMatrix);

          // Set color with opacity
          tmpColor.copy(particle.color);
          particleMesh.setColorAt(activeCount, tmpColor);

          activeCount++;
        }

        particleMesh.count = activeCount;
        if (activeCount > 0) {
          particleMesh.instanceMatrix.needsUpdate = true;
          if (particleMesh.instanceColor) {
            particleMesh.instanceColor.needsUpdate = true;
          }
        }
      }, 65); // After movement

      return unregister;
    }, [particles]);

    // Cleanup material on unmount
    useEffect(() => {
      return () => {
        materialRef.current?.dispose();
        particleMaterial.dispose();
      };
    }, [particleMaterial]);

    // Expose update function, mesh getter, and hit effect creator
    useImperativeHandle(ref, () => ({
      update: () => {
        const mesh = meshRef.current;
        if (!mesh) return;

        let instanceCount = 0;

        for (const shwarm of shwarms) {
          if (!shwarm.isActive) continue;

          for (const block of shwarm.blocks) {
            if (!block.isAlive) continue;
            if (instanceCount >= MAX_SHWARM_BLOCKS) break;

            // Set position
            tmpPosition.copy(block.position);

            // Set scale based on health (in 10% increments)
            // Geometry is already SHWARM_BLOCK_SIZE, so block.scale (0.2 to 1.0) gives us the visual size
            const visualScale = block.scale;
            tmpScale.set(visualScale, visualScale, visualScale);

            // Compose matrix
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            mesh.setMatrixAt(instanceCount, tmpMatrix);

            // Color based on health percentage (red -> dark red as damaged)
            const healthPercent = block.currentHealth / block.maxHealth;
            // Lerp from dark red (0x880000) to bright red (0xff4444)
            tmpColor.setRGB(
              0.53 + healthPercent * 0.47,  // 0.53 to 1.0
              healthPercent * 0.27,          // 0 to 0.27
              healthPercent * 0.27           // 0 to 0.27
            );
            mesh.setColorAt(instanceCount, tmpColor);

            instanceCount++;
          }

          if (instanceCount >= MAX_SHWARM_BLOCKS) break;
        }

        mesh.count = instanceCount;
        
        if (instanceCount > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
        }
      },
      getMesh: () => meshRef.current,
      createHitEffect,
    }), [shwarms, createHitEffect]);

    return (
      <>
        <instancedMesh
          ref={meshRef}
          args={[shwarmBlockGeometry, material, MAX_SHWARM_BLOCKS]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={particleMeshRef}
          args={[particleGeometry, particleMaterial, MAX_HIT_PARTICLES]}
          frustumCulled={false}
        />
      </>
    );
  }
);

ShwarmRenderer.displayName = 'ShwarmRenderer';