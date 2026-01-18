import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { SHWARM_BLOCK_SIZE, DEFAULT_SHWARM_COLOR, MAX_SHWARM_BLOCKS } from '../constants';
import type { ShwarmInstance } from '../hooks/useShwarmSystem';
import { frameLoop } from '@/lib/frameLoop';

// Pre-allocated objects for InstancedMesh updates
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();

// Shared geometry for all shwarm blocks (0.5 size)
const shwarmBlockGeometry = new THREE.BoxGeometry(
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE
);

// Particle geometry (small squares - larger for visibility)
const particleGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);

// Maximum particles for hit effects
const MAX_HIT_PARTICLES = 200;

// Cache for loaded textures
const textureCache = new Map<string, THREE.Texture>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

// Get or create material for a texture URL
function getOrCreateMaterial(textureUrl: string | null): THREE.MeshStandardMaterial {
  const cacheKey = textureUrl || 'default';
  
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!;
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // Always white base - texture provides color
    roughness: 0.4,
    metalness: 0.1,
    // Disable vertex colors initially - we'll enable when needed
  });

  if (textureUrl) {
    // Check texture cache first
    if (textureCache.has(textureUrl)) {
      mat.map = textureCache.get(textureUrl)!;
      mat.needsUpdate = true;
    } else {
      // Load texture asynchronously
      const loader = new THREE.TextureLoader();
      loader.load(
        textureUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          textureCache.set(textureUrl, texture);
          mat.map = texture;
          mat.needsUpdate = true;
          console.log(`[ShwarmRenderer] Loaded texture: ${textureUrl}`);
        },
        undefined,
        (error) => {
          console.warn(`[ShwarmRenderer] Failed to load texture: ${textureUrl}`, error);
          // Fallback to red color if texture fails
          mat.color.setHex(DEFAULT_SHWARM_COLOR);
          mat.needsUpdate = true;
        }
      );
    }
  } else {
    // No texture URL - use default red color
    mat.color.setHex(DEFAULT_SHWARM_COLOR);
  }

  materialCache.set(cacheKey, mat);
  return mat;
}

// Particle interface
interface HitParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  opacity: number;
  scale: number;
  active: boolean;
  color: THREE.Color;
}

export interface ShwarmRendererHandle {
  update: () => void;
  getMesh: () => THREE.InstancedMesh | null;
  createHitEffect: (position: THREE.Vector3, color?: number) => void;
}

interface ShwarmRendererProps {
  shwarms: ShwarmInstance[];
}

/**
 * Renders all shwarm blocks using InstancedMesh per texture for performance
 * Also renders hit particles when shwarms are damaged
 * Exposes update() for frame loop integration (no useFrame)
 */
export const ShwarmRenderer = forwardRef<ShwarmRendererHandle, ShwarmRendererProps>(
  ({ shwarms }, ref) => {
    const meshRefsMap = useRef<Map<string, THREE.InstancedMesh>>(new Map());
    const particleMeshRef = useRef<THREE.InstancedMesh>(null);

    // Get unique texture URLs from active shwarms
    const textureUrls = useMemo(() => {
      const urls = new Set<string>();
      for (const shwarm of shwarms) {
        const url = shwarm.definition.texture_url || 'default';
        urls.add(url);
      }
      return Array.from(urls);
    }, [shwarms]);

    // Create/get materials for each texture
    const materials = useMemo(() => {
      const mats: Map<string, THREE.MeshStandardMaterial> = new Map();
      for (const url of textureUrls) {
        const actualUrl = url === 'default' ? null : url;
        mats.set(url, getOrCreateMaterial(actualUrl));
      }
      return mats;
    }, [textureUrls]);

    // Create particle material
    const particleMaterial = useMemo(() => {
      return new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 1,
      });
    }, []);

    // Pre-allocate particles
    const particles = useMemo<HitParticle[]>(() => {
      const arr: HitParticle[] = [];
      for (let i = 0; i < MAX_HIT_PARTICLES; i++) {
        arr.push({
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          opacity: 0,
          scale: 0.08,
          active: false,
          color: new THREE.Color(0xff4444),
        });
      }
      return arr;
    }, []);

    // Create hit particle effect at position - spray of small squares like coin explosions
    const createHitEffect = (position: THREE.Vector3, color: number = DEFAULT_SHWARM_COLOR) => {
      const particleCount = 20; // More particles for better effect
      let spawned = 0;

      for (let i = 0; i < particles.length && spawned < particleCount; i++) {
        const particle = particles[i];
        if (!particle.active) {
          // Spherical distribution - radial burst
          const angle = (Math.PI * 2 * spawned) / particleCount + Math.random() * 0.3;
          const elevation = (Math.random() - 0.2) * Math.PI * 0.6;
          const speed = 5 + Math.random() * 6; // Faster for more punch

          particle.active = true;
          particle.position.copy(position);
          particle.velocity.set(
            Math.cos(angle) * Math.cos(elevation) * speed,
            Math.sin(elevation) * speed + 3, // bias upward
            Math.sin(angle) * Math.cos(elevation) * speed
          );
          particle.opacity = 1;
          particle.scale = 0.12 + Math.random() * 0.1; // Larger particles
          particle.color.setHex(color);
          spawned++;
        }
      }
    };

    // Register particle updates with frame loop
    useEffect(() => {
      const unregister = frameLoop.register('shwarmParticles', (delta) => {
        const particleMesh = particleMeshRef.current;
        if (!particleMesh) return;

        let activeCount = 0;
        const gravity = 15;

        for (const particle of particles) {
          if (!particle.active) continue;

          // Update position
          particle.position.addScaledVector(particle.velocity, delta);
          
          // Apply gravity
          particle.velocity.y -= gravity * delta;
          
          // Fade out
          particle.opacity -= delta * 2.5;

          if (particle.opacity <= 0 || particle.position.y <= 0) {
            particle.active = false;
            continue;
          }

          // Set matrix
          tmpPosition.copy(particle.position);
          tmpScale.set(particle.scale, particle.scale, particle.scale);
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
          particleMesh.setMatrixAt(activeCount, tmpMatrix);

          // Set color with opacity
          tmpColor.copy(particle.color);
          particleMesh.setColorAt(activeCount, tmpColor);

          activeCount++;
        }

        particleMesh.count = activeCount;
        if (activeCount > 0) {
          particleMesh.instanceMatrix.needsUpdate = true;
          if (particleMesh.instanceColor) {
            particleMesh.instanceColor.needsUpdate = true;
          }
        }
      }, 65); // After movement

      return unregister;
    }, [particles]);

    // Cleanup particle material on unmount
    useEffect(() => {
      return () => {
        particleMaterial.dispose();
      };
    }, [particleMaterial]);

    // Expose update function, mesh getter, and hit effect creator
    useImperativeHandle(ref, () => ({
      update: () => {
        // Group shwarms by texture URL
        const shwarmsByTexture = new Map<string, ShwarmInstance[]>();
        
        for (const shwarm of shwarms) {
          if (!shwarm.isActive) continue;
          const url = shwarm.definition.texture_url || 'default';
          if (!shwarmsByTexture.has(url)) {
            shwarmsByTexture.set(url, []);
          }
          shwarmsByTexture.get(url)!.push(shwarm);
        }

        // Update each instanced mesh
        for (const [textureUrl, textureShwarms] of shwarmsByTexture) {
          const mesh = meshRefsMap.current.get(textureUrl);
          if (!mesh) continue;

          let instanceCount = 0;

          for (const shwarm of textureShwarms) {
            for (const block of shwarm.blocks) {
              if (!block.isAlive) continue;
              if (instanceCount >= MAX_SHWARM_BLOCKS) break;

              // Set position
              tmpPosition.copy(block.position);

              // Set scale based on health (in 10% increments)
              const visualScale = block.scale;
              tmpScale.set(visualScale, visualScale, visualScale);

              // Compose matrix
              tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
              mesh.setMatrixAt(instanceCount, tmpMatrix);

              // Color tint based on health - white (1,1,1) at full health, darker when damaged
              // Using 0.4 minimum so blocks don't go completely black
              const healthPercent = block.currentHealth / block.maxHealth;
              const brightness = 0.4 + healthPercent * 0.6; // Range 0.4 to 1.0
              tmpColor.setRGB(brightness, brightness, brightness);
              mesh.setColorAt(instanceCount, tmpColor);

              instanceCount++;
            }

            if (instanceCount >= MAX_SHWARM_BLOCKS) break;
          }

          mesh.count = instanceCount;
          
          if (instanceCount > 0) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) {
              mesh.instanceColor.needsUpdate = true;
            }
          }
        }

        // Clear unused meshes
        for (const [url, mesh] of meshRefsMap.current) {
          if (!shwarmsByTexture.has(url)) {
            mesh.count = 0;
          }
        }
      },
      getMesh: () => meshRefsMap.current.values().next().value ?? null,
      createHitEffect,
    }), [shwarms, createHitEffect]);

    // Callback to store mesh refs
    const setMeshRef = (url: string) => (mesh: THREE.InstancedMesh | null) => {
      if (mesh) {
        meshRefsMap.current.set(url, mesh);
      } else {
        meshRefsMap.current.delete(url);
      }
    };

    return (
      <>
        {/* Render one instanced mesh per unique texture */}
        {textureUrls.map((url) => (
          <instancedMesh
            key={url}
            ref={setMeshRef(url)}
            args={[shwarmBlockGeometry, materials.get(url)!, MAX_SHWARM_BLOCKS]}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        ))}
        <instancedMesh
          ref={particleMeshRef}
          args={[particleGeometry, particleMaterial, MAX_HIT_PARTICLES]}
          frustumCulled={false}
        />
      </>
    );
  }
);

ShwarmRenderer.displayName = 'ShwarmRenderer';