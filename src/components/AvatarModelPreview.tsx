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
  const [clonedFbx, setClonedFbx] = useState<THREE.Group | null>(null);
  
  let fbx;
  try {
    fbx = useFBX(modelPath);
  } catch (error) {
    console.error('Preview: Failed to load FBX model:', error);
    return null;
  }

  useEffect(() => {
    if (!fbx) {
      console.log('Preview: No FBX loaded yet');
      return;
    }
    
    console.log('Preview: FBX loaded successfully', fbx);
    
    // Clone the FBX to avoid conflicts with the main scene
    const clonedModel = fbx.clone();
    setClonedFbx(clonedModel);
    
    // Configure materials
    clonedModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material) {
          const material = (child.material as THREE.MeshStandardMaterial).clone();
          material.color.set(color);
          material.metalness = 0.3;
          material.roughness = 0.7;
          child.material = material;
        }
      }
    });

    // Setup animation
    if (animationPath) {
      const loader = new FBXLoader();
      loader.load(
        animationPath,
        (animFBX) => {
          if (animFBX.animations && animFBX.animations.length > 0 && clonedModel) {
            mixerRef.current = new THREE.AnimationMixer(clonedModel);
            const action = mixerRef.current.clipAction(animFBX.animations[0]);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
          }
        },
        undefined,
        (error) => {
          console.warn('Failed to load preview animation:', error);
        }
      );
    }

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, color, animationPath]);

  useFrame((_, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
    
    // Slow rotation for better view
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
  });

  if (!clonedFbx) return null;

  return (
    <group ref={groupRef}>
      <primitive object={clonedFbx} scale={scale} />
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
        camera={{ position: [0, 0.8, 2.5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={() => console.log('Canvas created')}
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
