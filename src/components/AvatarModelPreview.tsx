import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX, OrbitControls } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

interface AvatarModelPreviewProps {
  modelPath: string;
  color: string;
  scale: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  animationPath?: string;
}

function Model({ modelPath, color, scale, scaleX, scaleY, scaleZ, animationPath }: AvatarModelPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const fbx = useFBX(modelPath);

  useEffect(() => {
    if (!fbx) return;
    
    // Configure materials and shadows - same as LocalPlayerAvatar but keep visible
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Keep on default layer 0 so it's visible
        child.layers.enable(0);
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set(color);
          material.metalness = 0.3;
          material.roughness = 0.7;
        }
      }
    });

    // Load animation if provided
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
          }
        },
        undefined,
        (error) => console.warn('Failed to load preview animation:', error)
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
    
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.005;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.9, 0]}>
      <primitive 
        object={fbx} 
        scale={[scale * scaleX, scale * scaleY, scale * scaleZ]} 
      />
    </group>
  );
}

function Scene({ modelPath, color, scale, scaleX, scaleY, scaleZ, animationPath }: AvatarModelPreviewProps) {
  // Calculate avatar height in world units (base model ~100 units * scale * scaleY)
  const avatarHeight = scale * scaleY * 100;
  // Position target at 40% of avatar height from feet to show feet at ~1/3 from bottom
  const targetY = -0.9 + (avatarHeight * 0.4);
  
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
      <directionalLight position={[-5, 3, -5]} intensity={0.5} />
      <React.Suspense fallback={null}>
        <Model modelPath={modelPath} color={color} scale={scale} scaleX={scaleX} scaleY={scaleY} scaleZ={scaleZ} animationPath={animationPath} />
      </React.Suspense>
      <OrbitControls enablePan={false} enableZoom={true} target={[0, targetY, 0]} />
      <gridHelper args={[10, 10]} position={[0, -0.9, 0]} />
    </>
  );
}

export function AvatarModelPreview({ modelPath, color, scale, scaleX, scaleY, scaleZ, animationPath }: AvatarModelPreviewProps) {
  // Scale the camera distance based on model scale
  // At scale 0.01 (default), use base distance
  // Camera scales proportionally with model
  const distance = scale * 200; // 0.01 -> 2, 0.02 -> 4, etc.
  
  return (
    <div className="w-full h-full rounded-lg border-2 border-primary/20 overflow-hidden">
      <Canvas
        camera={{ position: [distance, distance * 0.25, distance * 1.5], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene 
          modelPath={modelPath}
          color={color}
          scale={scale}
          scaleX={scaleX}
          scaleY={scaleY}
          scaleZ={scaleZ}
          animationPath={animationPath}
        />
      </Canvas>
    </div>
  );
}
