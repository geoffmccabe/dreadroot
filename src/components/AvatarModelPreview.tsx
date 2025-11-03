import React, { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX, OrbitControls } from '@react-three/drei';

interface AvatarModelPreviewProps {
  modelPath: string;
  color: string;
  scale: number;
  animationPath?: string;
}

function TestCube() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
  });
  
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  );
}

function Model({ modelPath, color, scale }: AvatarModelPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fbx = useFBX(modelPath);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.005;
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={fbx} scale={scale * 100} />
    </group>
  );
}

function Scene({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <TestCube />
      <Suspense fallback={null}>
        <Model modelPath={modelPath} color={color} scale={scale} animationPath={animationPath} />
      </Suspense>
      <OrbitControls enablePan={false} />
    </>
  );
}

export function AvatarModelPreview({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  return (
    <div className="w-full h-full rounded-lg border-2 border-primary/20 overflow-hidden">
      <Canvas
        camera={{ position: [3, 2, 5], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene 
          modelPath={modelPath}
          color={color}
          scale={scale}
          animationPath={animationPath}
        />
      </Canvas>
    </div>
  );
}
