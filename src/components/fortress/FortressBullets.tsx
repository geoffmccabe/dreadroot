import React from 'react';
import { Bullet } from './FortressTypes';

interface BulletsProps {
  bullets: Bullet[];
}

export function Bullets({ bullets }: BulletsProps) {
  return (
    <group>
      {bullets.map((bullet, index) => (
        <mesh 
          key={index} 
          position={[bullet.position.x, bullet.position.y, bullet.position.z]}
        >
          <sphereGeometry args={[0.05]} />
          <meshBasicMaterial color="#ffff00" />
        </mesh>
      ))}
    </group>
  );
}
