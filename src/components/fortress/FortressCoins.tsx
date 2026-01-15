import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Coin, ExplosionParticle } from './FortressTypes';

interface CoinsProps {
  coinRate?: number;
  coinSize?: number;
  flowSpeed?: number;
  onGetCoins?: () => Coin[];
  coinImageUrl?: string;
}

export function Coins({
  coinRate = 60,
  coinSize = 1.2,
  flowSpeed = 1.2,
  onGetCoins,
  coinImageUrl
}: CoinsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const coinTimerRef = useRef(0);
  const maxCoins = 200;
  const maxExplosionParticles = 100;

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

        console.log('🪙 Coin texture loaded:', {
          format: texture.format,
          size: `${texture.image?.width}x${texture.image?.height}`
        });

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

  // Initialize coins
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

  // Explosion particles
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

      if (coin.mesh) {
        coin.mesh.visible = true;
        coin.mesh.position.copy(coin.position);
      }
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

        if (particle.mesh) {
          particle.mesh.visible = true;
          particle.mesh.position.copy(particle.position);
          particle.mesh.scale.set(particle.scale, particle.scale, 1);
          (particle.mesh.material as THREE.SpriteMaterial).opacity = particle.opacity;
        }

        spawned++;
      }
    }
  }, [explosionParticles, coinSize]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const interval = 1 / coinRate;
    coinTimerRef.current += delta;

    if (coinTimerRef.current >= interval) {
      spawnCoin();
      coinTimerRef.current = 0;
    }

    const gravity = 9.8 * flowSpeed;

    // Update coin physics
    coins.forEach((coin) => {
      if (!coin.mesh || !coin.visible) return;

      coin.velocity += gravity * delta;
      coin.position.y -= coin.velocity * delta;
      coin.rotation += coin.rotSpeed * delta;

      coin.mesh.position.copy(coin.position);
      (coin.mesh.material as THREE.SpriteMaterial).rotation = coin.rotation;

      if (coin.position.y <= 0.2) {
        coin.visible = false;
        coin.mesh.visible = false;
      }
    });

    // Update explosion particles
    explosionParticles.forEach((particle) => {
      if (!particle.active || !particle.mesh) return;

      particle.position.add(particle.velocity.clone().multiplyScalar(delta));
      particle.velocityY += gravity * delta;
      particle.position.y -= particle.velocityY * delta;
      particle.rotation += particle.rotSpeed * delta;
      particle.opacity -= delta * 1.5;

      particle.mesh.position.copy(particle.position);
      (particle.mesh.material as THREE.SpriteMaterial).rotation = particle.rotation;
      (particle.mesh.material as THREE.SpriteMaterial).opacity = Math.max(0, particle.opacity);

      if (particle.opacity <= 0 || particle.position.y <= 0) {
        particle.active = false;
        particle.mesh.visible = false;
      }
    });
  });

  // Expose coins and explosion function for bullet collision
  useEffect(() => {
    if (onGetCoins) {
      (window as any).getCoins = () => coins;
      (window as any).createCoinExplosion = createExplosion;
    }
  }, [coins, onGetCoins, createExplosion]);

  return (
    <group ref={groupRef}>
      {coins.map((coin, index) => (
        <sprite
          key={index}
          ref={(ref) => { coin.mesh = ref; }}
          visible={false}
          scale={[coinSize * coin.scaleJitter, coinSize * coin.scaleJitter, 1]}
        >
          <spriteMaterial
            map={coinTexture}
            transparent
            alphaTest={0.5}
          />
        </sprite>
      ))}
      {explosionParticles.map((particle, index) => (
        <sprite
          key={`particle-${index}`}
          ref={(ref) => { particle.mesh = ref; }}
          visible={false}
          scale={[0.5, 0.5, 1]}
        >
          <spriteMaterial
            map={coinTexture}
            transparent
            alphaTest={0.5}
          />
        </sprite>
      ))}
    </group>
  );
}
