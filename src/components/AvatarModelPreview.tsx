import React, { useRef, useEffect, Suspense } from 'react';
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
  const clonedFbxRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!fbx) return;
    
    // Clone the FBX to avoid conflicts with the main scene
    const clonedFbx = fbx.clone();
    clonedFbxRef.current = clonedFbx;
    
    // Configure materials
    clonedFbx.traverse((child) => {
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
          if (animFBX.animations && animFBX.animations.length > 0 && clonedFbx) {
            mixerRef.current = new THREE.AnimationMixer(clonedFbx);
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

  if (!clonedFbxRef.current) return null;

  return (
    <group ref={groupRef}>
      <primitive object={clonedFbxRef.current} scale={scale} />
    </group>
  );
}

export function AvatarModelPreview({ modelPath, color, scale, animationPath }: AvatarModelPreviewProps) {
  return (
    <div className="w-full h-full bg-background/50 rounded-lg border-2 border-primary/20 overflow-hidden">
      <Canvas
        camera={{ position: [0, 0.8, 2.5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-5, 5, -5]} intensity={0.6} />
        <pointLight position={[0, 2, 0]} intensity={0.5} />
        
        <Suspense fallback={null}>
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
