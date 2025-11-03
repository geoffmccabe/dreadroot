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


function Model({ modelPath, color, scale }: AvatarModelPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fbx = useFBX(modelPath);

  React.useEffect(() => {
    if (fbx) {
      fbx.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color.set(color);
        }
      });
      console.log('FBX model loaded and configured');
    }
  }, [fbx, color]);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.005;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={fbx} scale={1} position={[0, -0.9, 0]} />
    </group>
  );
}

function Scene({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <directionalLight position={[-5, 3, -5]} intensity={0.5} />
      <Suspense fallback={null}>
        <Model modelPath={modelPath} color={color} scale={scale} animationPath={animationPath} />
      </Suspense>
      <OrbitControls enablePan={false} enableZoom={true} />
      <gridHelper args={[10, 10]} />
    </>
  );
}

export function AvatarModelPreview({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  return (
    <div className="w-full h-full rounded-lg border-2 border-primary/20 overflow-hidden">
      <Canvas
        camera={{ position: [2, 1, 3], fov: 50 }}
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
