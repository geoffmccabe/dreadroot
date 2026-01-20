// Particle effects along fortress walls
// Places 5 effect types evenly spaced on each wall top, with shared corners

import { useMemo } from 'react';
import { ParticleEffect } from '@/features/particles';
import { ParticleEffectType } from '@/features/particles/types';
import { FORTRESS_DIMENSIONS } from './FortressCollision';

const EFFECT_TYPES: ParticleEffectType[] = ['fire', 'explosion', 'sparkles', 'smoke', 'magic'];

interface WallPosition {
  position: [number, number, number];
  type: ParticleEffectType;
}

export function FortressParticles() {
  const { cliffW, cliffH, frontZ, courtyardDepth, frontT } = FORTRESS_DIMENSIONS;
  
  // Calculate wall boundaries
  const halfWidth = cliffW / 2;
  const wallTop = cliffH + 0.5; // Slightly above wall
  const backZ = frontZ - courtyardDepth - frontT;
  
  // Generate positions for all 4 walls with 5 effects each (shared corners)
  const positions = useMemo(() => {
    const allPositions: WallPosition[] = [];
    let effectIndex = 0;
    
    // Helper to get next effect type in cycle
    const getNextEffect = (): ParticleEffectType => {
      const effect = EFFECT_TYPES[effectIndex % EFFECT_TYPES.length];
      effectIndex++;
      return effect;
    };
    
    // Front wall (left to right): X from -halfWidth to +halfWidth, Z = frontZ
    // 5 positions including corners
    for (let i = 0; i < 5; i++) {
      const t = i / 4; // 0, 0.25, 0.5, 0.75, 1
      const x = -halfWidth + t * cliffW;
      allPositions.push({
        position: [x, wallTop, frontZ],
        type: getNextEffect(),
      });
    }
    
    // Right wall (front to back): X = halfWidth, Z from frontZ to backZ
    // 4 positions (skip first corner, already placed by front wall)
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const z = frontZ - t * (frontZ - backZ);
      allPositions.push({
        position: [halfWidth, wallTop, z],
        type: getNextEffect(),
      });
    }
    
    // Back wall (right to left): X from +halfWidth to -halfWidth, Z = backZ
    // 4 positions (skip first corner, already placed by right wall)
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = halfWidth - t * cliffW;
      allPositions.push({
        position: [x, wallTop, backZ],
        type: getNextEffect(),
      });
    }
    
    // Left wall (back to front): X = -halfWidth, Z from backZ to frontZ
    // 3 positions (skip first and last corners, already placed)
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const z = backZ + t * (frontZ - backZ);
      allPositions.push({
        position: [-halfWidth, wallTop, z],
        type: getNextEffect(),
      });
    }
    
    return allPositions;
  }, [cliffW, cliffH, frontZ, courtyardDepth, frontT, halfWidth, backZ, wallTop]);

  return (
    <group>
      {positions.map((pos, index) => (
        <ParticleEffect
          key={`fortress-particle-${index}`}
          type={pos.type}
          position={pos.position}
          scale={1.5}
          active={true}
        />
      ))}
    </group>
  );
}
