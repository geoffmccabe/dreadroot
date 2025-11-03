import React, { useRef, useEffect, Suspense, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

interface AvatarModelPreviewProps {
  modelPath: string;
  color: string;
  scale: number;
  animationPath?: string;
}

function Model({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  
  const fbx = useFBX(modelPath);

  useEffect(() => {
    if (!fbx) return;
    
    console.log('Setting up model materials');
    
    // Configure materials directly on the loaded model
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.color.set(color);
        mat.needsUpdate = true;
      }
    });

    // Setup animation if provided
    if (animationPath) {
      const loader = new FBXLoader();
      loader.load(
        animationPath,
        (animFBX) => {
          if (animFBX.animations?.length > 0) {
            mixerRef.current = new THREE.AnimationMixer(fbx);
            const action = mixerRef.current.clipAction(animFBX.animations[0]);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
            console.log('Animation loaded and playing');
          }
        },
        undefined,
        (error) => console.warn('Animation load failed:', error)
      );
    }

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, color, animationPath]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
    
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  console.log('Rendering model with scale:', scale);

  return (
    <group ref={groupRef}>
      <primitive object={fbx} scale={scale} position={[0, -0.9, 0]} />
    </group>
  );
}

function LoadingIndicator() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4a9eff" />
    </mesh>
  );
}

export function AvatarModelPreview({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  const [error, setError] = useState<string | null>(null);
  
  console.log('Preview render with:', { modelPath, color, scale, animationPath });
  
  return (
    <div className="w-full h-full bg-background/50 rounded-lg border-2 border-primary/20 overflow-hidden relative">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm p-4 text-center">
          {error}
        </div>
      )}
      <Canvas
        camera={{ position: [0, 1, 3], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={() => console.log('Canvas created for preview')}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-5, 5, -5]} intensity={0.6} />
        <pointLight position={[0, 2, 0]} intensity={0.5} />
        
        <Suspense fallback={<LoadingIndicator />}>
          <Model 
            modelPath={modelPath}
            color={color}
            scale={scale}
            animationPath={animationPath}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
