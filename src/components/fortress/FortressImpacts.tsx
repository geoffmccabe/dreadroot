// Bullet impact effects component
// Manages fire-like impact effects when bullets hit blocks
// Uses THREE.js InstancedMesh for reliable, high-performance particles

import React, { useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Maximum concurrent particles across all impacts
const MAX_PARTICLES = 200;

// Default impact configuration
const DEFAULT_IMPACT_COLOR = '#FFAA00'; // Yellow/orange
const DEFAULT_IMPACT_SIZE = 0.25; // 0.25 meter base diameter
const DEFAULT_IMPACT_DURATION = 500; // 0.5 seconds in ms
const PARTICLES_PER_IMPACT = 15;

export interface ImpactConfig {
  color?: string;   // Hex color for the impact (default: yellow/orange)
  size?: number;    // Base size in meters (default: 0.25m)
  tier?: number;    // Bullet tier for scaling (default: 1, adds 10% per tier)
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ImpactParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  size: number;
}

// Shared geometry and material
const particleGeometry = new THREE.SphereGeometry(0.02, 6, 6);
const particleMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.9,
});

const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<ImpactParticle[]>([]);

  // Spawn an impact effect at position
  const spawnImpact = useCallback((position: THREE.Vector3, config?: ImpactConfig) => {
    const color = config?.color || DEFAULT_IMPACT_COLOR;
    const baseSize = config?.size || DEFAULT_IMPACT_SIZE;
    const tier = config?.tier || 1;
    
    // Calculate final size: base + 10% per tier
    const finalSize = baseSize * (1 + tier * 0.1);
    const lifeDuration = DEFAULT_IMPACT_DURATION / 1000; // Convert to seconds
    
    // Parse colors for gradient
    const startColor = new THREE.Color(color);
    const endColor = startColor.clone().multiplyScalar(0.4); // Darken
    
    // Create burst of particles
    for (let i = 0; i < PARTICLES_PER_IMPACT; i++) {
      // Remove oldest if at capacity
      if (particlesRef.current.length >= MAX_PARTICLES) {
        particlesRef.current.shift();
      }
      
      // Random direction with upward bias (fire rises)
      const angle = Math.random() * Math.PI * 2;
      const upwardBias = 0.5 + Math.random() * 0.5; // 0.5-1.0 upward
      const horizontalSpeed = (0.5 + Math.random() * 1.5) * finalSize * 4;
      
      const velocity = new THREE.Vector3(
        Math.cos(angle) * horizontalSpeed,
        upwardBias * 2 * finalSize * 4,
        Math.sin(angle) * horizontalSpeed
      );
      
      particlesRef.current.push({
        position: position.clone(),
        velocity,
        life: lifeDuration * (0.5 + Math.random() * 0.5), // Varied life
        maxLife: lifeDuration,
        color: startColor.clone(),
        size: finalSize * (0.5 + Math.random() * 0.5),
      });
    }
  }, []);

  // Expose the spawnImpact function
  useImperativeHandle(ref, () => ({
    spawnImpact,
  }), [spawnImpact]);

  // Update particles
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    
    const particles = particlesRef.current;
    let writeIndex = 0;
    
    // Update and filter particles in-place
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      
      // Update physics
      p.position.addScaledVector(p.velocity, delta);
      p.velocity.y += 1.5 * delta; // Slight upward drift (fire rises)
      p.velocity.multiplyScalar(0.95); // Drag
      p.life -= delta;
      
      if (p.life > 0) {
        // Calculate alpha based on life
        const lifeRatio = p.life / p.maxLife;
        
        // Update instance matrix
        const scale = p.size * lifeRatio; // Shrink as it fades
        tempMatrix.makeScale(scale, scale, scale);
        tempMatrix.setPosition(p.position.x, p.position.y, p.position.z);
        meshRef.current.setMatrixAt(writeIndex, tempMatrix);
        
        // Fade color from bright to dark
        tempColor.copy(p.color).multiplyScalar(lifeRatio);
        meshRef.current.setColorAt(writeIndex, tempColor);
        
        // Keep particle
        particles[writeIndex] = p;
        writeIndex++;
      }
    }
    
    // Truncate array
    particles.length = writeIndex;
    
    // Update instance count and matrices
    meshRef.current.count = writeIndex;
    if (writeIndex > 0) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      if (meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[particleGeometry, particleMaterial, MAX_PARTICLES]}
      frustumCulled={false}
    />
  );
});

BulletImpacts.displayName = 'BulletImpacts';
