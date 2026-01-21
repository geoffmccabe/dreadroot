// Player fire effect - renders fire particles around a player who was hit
import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface PlayerFireEffectProps {
  isOnFire: boolean;
  burnTimeMs: number;
  colors?: string[];
  isLocalPlayer?: boolean;
}

// Fire particle configuration
const PARTICLE_COUNT = 12;
const BASE_HEIGHT = 0.8;
const SPREAD_RADIUS = 0.3;

export function PlayerFireEffect({ 
  isOnFire, 
  burnTimeMs, 
  colors = ['#ff4400', '#ff8800', '#ffcc00'],
  isLocalPlayer = false
}: PlayerFireEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<Array<{
    mesh: THREE.Mesh;
    baseY: number;
    phase: number;
    speed: number;
  }>>([]);
  const startTimeRef = useRef(0);
  
  // Create fire particle meshes
  const particles = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(0.15, 0.3);
    const result: THREE.Mesh[] = [];
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const colorIndex = i % colors.length;
      const material = new THREE.MeshBasicMaterial({
        color: colors[colorIndex],
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      result.push(mesh);
    }
    
    return result;
  }, [colors]);
  
  // Initialize particles with random positions
  useEffect(() => {
    if (!groupRef.current) return;
    
    // Clear existing children
    while (groupRef.current.children.length > 0) {
      groupRef.current.remove(groupRef.current.children[0]);
    }
    
    particlesRef.current = [];
    
    particles.forEach((mesh, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const radius = SPREAD_RADIUS * (0.5 + Math.random() * 0.5);
      
      mesh.position.x = Math.cos(angle) * radius;
      mesh.position.z = Math.sin(angle) * radius;
      mesh.position.y = BASE_HEIGHT * (0.3 + Math.random() * 0.7);
      
      groupRef.current!.add(mesh);
      
      particlesRef.current.push({
        mesh,
        baseY: mesh.position.y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.5,
      });
    });
  }, [particles]);
  
  // Track fire start time
  useEffect(() => {
    if (isOnFire) {
      startTimeRef.current = performance.now();
    }
  }, [isOnFire]);
  
  // Animate fire particles
  useFrame((_, delta) => {
    if (!isOnFire || particlesRef.current.length === 0) {
      // Hide all particles when not on fire
      particlesRef.current.forEach(p => {
        p.mesh.visible = false;
      });
      return;
    }
    
    const elapsed = performance.now() - startTimeRef.current;
    const progress = Math.min(elapsed / burnTimeMs, 1);
    const fadeOut = progress > 0.7 ? 1 - ((progress - 0.7) / 0.3) : 1;
    
    const time = elapsed * 0.001;
    
    particlesRef.current.forEach((p, i) => {
      p.mesh.visible = true;
      
      // Flickering motion
      const flicker = Math.sin(time * p.speed * 10 + p.phase) * 0.5 + 0.5;
      p.mesh.position.y = p.baseY + Math.sin(time * p.speed * 5 + p.phase) * 0.1;
      
      // Scale based on flicker and fade
      const scale = (0.5 + flicker * 0.5) * fadeOut;
      p.mesh.scale.set(scale, scale * 1.5, scale);
      
      // Opacity based on flicker and fade
      const material = p.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (0.4 + flicker * 0.4) * fadeOut;
      
      // Billboard: face camera
      p.mesh.lookAt(0, p.mesh.position.y, 10);
    });
  });
  
  // For local player, position effect at camera level
  const yOffset = isLocalPlayer ? -0.5 : 0;
  
  return (
    <group ref={groupRef} position={[0, yOffset, 0]} />
  );
}
