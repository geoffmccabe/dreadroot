import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Coin, ExplosionParticle } from './FortressTypes';
import { useBlocks } from '@/contexts/BlocksContext';
import { CHUNK_SIZE } from '@/lib/chunkManager';

interface CoinsProps {
  coinRate?: number;
  coinSize?: number;
  flowSpeed?: number;
  onGetCoins?: () => Coin[];
  coinImageUrl?: string;
}

// Reusable objects to avoid GC pressure
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempColor = new THREE.Color();

export function Coins({
  coinRate = 60,
  coinSize = 1.2,
  flowSpeed = 1.2,
  onGetCoins,
  coinImageUrl
}: CoinsProps) {
  const coinMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);
  const coinTimerRef = useRef(0);
  const maxCoins = 200;
  const maxExplosionParticles = 100;

  // Distance culling
  const { camera } = useThree();
  const { visualDistance } = useBlocks();
  const [isVisible, setIsVisible] = useState(true);
  const lastVisibilityCheck = useRef(0);
  const VISIBILITY_CHECK_THROTTLE = 200; // ms
  
  const coinCenter = { x: 0, z: -6 };

  // Load coin texture
  const [coinTexture, setCoinTexture] = useState<THREE.Texture | null>(null);
  const coinTextureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const imageUrl = coinImageUrl || '/waterfall_coin.png';

    loader.load(
      imageUrl,
      (texture) => {
        texture.format = THREE.RGBAFormat;
        texture.premultiplyAlpha = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        coinTextureRef.current = texture;
        setCoinTexture(texture);
      },
      undefined,
      (error) => {
        console.error('Failed to load coin texture:', error);
      }
    );

    return () => {
      if (coinTextureRef.current) {
        coinTextureRef.current.dispose();
        coinTextureRef.current = null;
      }
    };
  }, [coinImageUrl]);

  // Initialize coins as plain data (no mesh references)
  const coins = useMemo<Coin[]>(() => {
    const coinsArray: Coin[] = [];
    for (let i = 0; i < maxCoins; i++) {
      coinsArray.push({
        position: new THREE.Vector3(0, 20, -6),
        velocity: 0,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * Math.PI * 2,
        scaleJitter: 1 + (Math.random() * 0.4 - 0.2),
        visible: false,
        mesh: null
      });
    }
    return coinsArray;
  }, []);

  // Explosion particles as plain data
  const explosionParticles = useMemo<ExplosionParticle[]>(() => {
    const particles: ExplosionParticle[] = [];
    for (let i = 0; i < maxExplosionParticles; i++) {
      particles.push({
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        velocityY: 0,
        rotation: 0,
        rotSpeed: 0,
        opacity: 0,
        scale: 0,
        active: false,
        mesh: null
      });
    }
    return particles;
  }, []);

  const spawnCoin = useCallback(() => {
    const coinIndex = coins.findIndex(c => !c.visible);
    if (coinIndex !== -1) {
      const coin = coins[coinIndex];
      coin.visible = true;
      coin.position.set(
        (Math.random() - 0.5) * 4,
        20,
        -6 + (Math.random() - 0.5) * 0.6
      );
      coin.velocity = 0;
      coin.rotation = Math.random() * Math.PI * 2;
      coin.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 2;
    }
  }, [coins]);

  // Create explosion effect
  const createExplosion = useCallback((position: THREE.Vector3, fallingVelocity: number) => {
    const particleCount = 16;
    let spawned = 0;

    for (let i = 0; i < explosionParticles.length && spawned < particleCount; i++) {
      const particle = explosionParticles[i];
      if (!particle.active) {
        const angle = (Math.PI * 2 * spawned) / particleCount;
        const elevation = (Math.random() - 0.5) * Math.PI * 0.5;
        const speed = (2 + Math.random() * 3) * 3;

        particle.active = true;
        particle.position.copy(position);
        particle.velocity.set(
          Math.cos(angle) * Math.cos(elevation) * speed,
          Math.sin(elevation) * speed,
          Math.sin(angle) * Math.cos(elevation) * speed
        );
        particle.velocityY = fallingVelocity;
        particle.rotation = Math.random() * Math.PI * 2;
        particle.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 4;
        particle.opacity = 1;
        particle.scale = coinSize * 0.4;
        spawned++;
      }
    }
  }, [explosionParticles, coinSize]);

  useFrame((state, delta) => {
    // Check visibility with throttle
    const now = Date.now();
    if (now - lastVisibilityCheck.current > VISIBILITY_CHECK_THROTTLE) {
      lastVisibilityCheck.current = now;
      const distanceToCoins = Math.sqrt(
        Math.pow(camera.position.x - coinCenter.x, 2) +
        Math.pow(camera.position.z - coinCenter.z, 2)
      );
      const maxDistance = visualDistance * CHUNK_SIZE;
      const shouldBeVisible = distanceToCoins <= maxDistance;
      if (shouldBeVisible !== isVisible) {
        setIsVisible(shouldBeVisible);
      }
    }
    
    if (!isVisible) return;
    
    const interval = 1 / coinRate;
    coinTimerRef.current += delta;

    if (coinTimerRef.current >= interval) {
      spawnCoin();
      coinTimerRef.current = 0;
    }

    const gravity = 9.8 * flowSpeed;

    // Update coin physics and instanced mesh
    if (coinMeshRef.current) {
      let visibleCount = 0;
      
      for (const coin of coins) {
        if (!coin.visible) continue;

        coin.velocity += gravity * delta;
        coin.position.y -= coin.velocity * delta;
        coin.rotation += coin.rotSpeed * delta;

        if (coin.position.y <= 0.2) {
          coin.visible = false;
          continue;
        }

        // Update instanced mesh matrix
        const scale = coinSize * coin.scaleJitter;
        tempPosition.copy(coin.position);
        tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), coin.rotation);
        tempScale.set(scale, scale, 1);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        coinMeshRef.current.setMatrixAt(visibleCount, tempMatrix);
        
        visibleCount++;
      }
      
      coinMeshRef.current.count = visibleCount;
      coinMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // Update explosion particles
    if (particleMeshRef.current) {
      let activeCount = 0;
      
      for (const particle of explosionParticles) {
        if (!particle.active) continue;

        particle.position.add(particle.velocity.clone().multiplyScalar(delta));
        particle.velocityY += gravity * delta;
        particle.position.y -= particle.velocityY * delta;
        particle.rotation += particle.rotSpeed * delta;
        particle.opacity -= delta * 1.5;

        if (particle.opacity <= 0 || particle.position.y <= 0) {
          particle.active = false;
          continue;
        }

        // Update instanced mesh matrix
        tempPosition.copy(particle.position);
        tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), particle.rotation);
        tempScale.set(particle.scale, particle.scale, 1);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        particleMeshRef.current.setMatrixAt(activeCount, tempMatrix);
        
        // Set opacity via color alpha simulation (use white with varying opacity)
        tempColor.setRGB(1, 1, 1);
        particleMeshRef.current.setColorAt(activeCount, tempColor);
        
        activeCount++;
      }
      
      particleMeshRef.current.count = activeCount;
      particleMeshRef.current.instanceMatrix.needsUpdate = true;
      if (particleMeshRef.current.instanceColor) {
        particleMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  // Expose coins and explosion function for bullet collision
  useEffect(() => {
    if (onGetCoins) {
      (window as any).getCoins = () => coins;
      (window as any).createCoinExplosion = createExplosion;
    }
  }, [coins, onGetCoins, createExplosion]);

  // Don't render if too far away
  if (!isVisible) return null;

  return (
    <group>
      {/* Coins as instanced mesh */}
      <instancedMesh
        ref={coinMeshRef}
        args={[undefined, undefined, maxCoins]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={coinTexture}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      
      {/* Explosion particles as instanced mesh */}
      <instancedMesh
        ref={particleMeshRef}
        args={[undefined, undefined, maxExplosionParticles]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={coinTexture}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
}
