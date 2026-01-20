// Bullet impact effects component
// Manages fire-like impact effects when bullets hit blocks

import React, { useRef, useImperativeHandle, forwardRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Maximum concurrent impact effects
const MAX_IMPACTS = 10;

// Default impact configuration
const DEFAULT_IMPACT_COLOR = '#FFAA00'; // Yellow/orange
const DEFAULT_IMPACT_SIZE = 0.25; // 0.25 meter base diameter
const DEFAULT_IMPACT_DURATION = 500; // 0.5 seconds in ms
const PARTICLES_PER_IMPACT = 12;

export interface ImpactConfig {
  color?: string;   // Hex color for the impact (default: yellow/orange)
  size?: number;    // Base size in meters (default: 0.25m)
  tier?: number;    // Bullet tier for scaling (default: 1, adds 10% per tier)
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ImpactParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface ActiveImpact {
  particles: ImpactParticle[];
  startTime: number;
}

// Create a simple glowing particle material
function createParticleMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
}

// Base geometry is a unit sphere - we'll scale it to the desired size
const particleGeometry = new THREE.SphereGeometry(1, 8, 8);

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const particlePoolRef = useRef<THREE.Mesh[]>([]);
  const poolIndexRef = useRef(0);

  // Pre-create particle pool
  useEffect(() => {
    const poolSize = MAX_IMPACTS * PARTICLES_PER_IMPACT;
    for (let i = 0; i < poolSize; i++) {
      const material = createParticleMaterial('#FFAA00');
      const mesh = new THREE.Mesh(particleGeometry, material);
      mesh.visible = false;
      scene.add(mesh);
      particlePoolRef.current.push(mesh);
    }

    return () => {
      particlePoolRef.current.forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      particlePoolRef.current = [];
    };
  }, [scene]);

  // Spawn an impact effect at position
  const spawnImpact = useCallback((position: THREE.Vector3, config?: ImpactConfig) => {
    const color = config?.color || DEFAULT_IMPACT_COLOR;
    const baseSize = config?.size || DEFAULT_IMPACT_SIZE;
    const tier = config?.tier || 1;
    
    // Calculate final size: base + 10% per tier
    const finalSize = baseSize * (1 + tier * 0.1);
    const lifeDuration = DEFAULT_IMPACT_DURATION / 1000;
    
    // Remove oldest impact if at capacity
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      const oldest = activeImpactsRef.current.shift();
      if (oldest) {
        oldest.particles.forEach(p => {
          p.mesh.visible = false;
        });
      }
    }
    
    const particles: ImpactParticle[] = [];
    const pool = particlePoolRef.current;
    
    // Create burst of particles from pool
    for (let i = 0; i < PARTICLES_PER_IMPACT; i++) {
      const mesh = pool[poolIndexRef.current % pool.length];
      poolIndexRef.current++;
      
      // Update material color
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      
      // Random direction with upward bias (fire rises)
      const angle = Math.random() * Math.PI * 2;
      const upwardBias = 0.5 + Math.random() * 0.5;
      const horizontalSpeed = (0.3 + Math.random() * 0.7) * finalSize * 3;
      
      const velocity = new THREE.Vector3(
        Math.cos(angle) * horizontalSpeed,
        upwardBias * finalSize * 4,
        Math.sin(angle) * horizontalSpeed
      );
      
      mesh.position.copy(position);
      mesh.visible = true;
      
      // Scale to get 0.25m diameter base, with variation (0.3-1.0x)
      // finalSize is the diameter, divide by 2 for radius
      const particleRadius = (finalSize / 2) * (0.3 + Math.random() * 0.7);
      mesh.scale.setScalar(particleRadius);
      
      particles.push({
        mesh,
        velocity,
        life: lifeDuration * (0.4 + Math.random() * 0.6),
        maxLife: lifeDuration,
        baseScale: particleRadius,
      });
    }
    
    activeImpactsRef.current.push({
      particles,
      startTime: performance.now(),
    });
  }, []);

  // Expose the spawnImpact function
  useImperativeHandle(ref, () => ({
    spawnImpact,
  }), [spawnImpact]);

  // Update particles
  useFrame((_, delta) => {
    const now = performance.now();
    
    for (let i = activeImpactsRef.current.length - 1; i >= 0; i--) {
      const impact = activeImpactsRef.current[i];
      let allDead = true;
      
      for (const p of impact.particles) {
        if (p.life > 0) {
          allDead = false;
          
          // Update physics
          p.mesh.position.addScaledVector(p.velocity, delta);
          p.velocity.y += 1.0 * delta; // Slight upward drift (fire rises)
          p.velocity.multiplyScalar(0.92); // Drag
          p.life -= delta;
          
          // Fade and shrink
          const lifeRatio = Math.max(0, p.life / p.maxLife);
          const scale = p.baseScale * lifeRatio; // baseScale is already the radius
          p.mesh.scale.setScalar(scale);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = lifeRatio * 0.9;
        } else {
          // Hide dead particles immediately
          p.mesh.visible = false;
        }
      }
      
      // Remove impact when all particles are dead
      if (allDead) {
        impact.particles.forEach(p => {
          p.mesh.visible = false;
        });
        activeImpactsRef.current.splice(i, 1);
      }
    }
  });

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';
