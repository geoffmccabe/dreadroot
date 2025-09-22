import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { BillboardControlPanel } from '@/components/BillboardControlPanel';
import { BillboardWalls } from '@/components/BillboardWalls';

// Sky component with beautiful gradient
function SkyTexture() {
  const { scene } = useThree();
  
  useEffect(() => {
    // Create a beautiful gradient sky using a shader
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;
    
    // Create sky sphere with gradient shader
    const skyGeo = new THREE.SphereGeometry(320, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        topColor: { value: new THREE.Color(0x91c7f5) },    // Light blue
        bottomColor: { value: new THREE.Color(0xffffff) }, // White
        offset: { value: 33 },
        exponent: { value: 0.6 }
      },
      side: THREE.BackSide
    });
    
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
    
    return () => {
      scene.remove(skyMesh);
      skyGeo.dispose();
      skyMat.dispose();
    };
  }, [scene]);
  
  return null;
}

// First person controls component
function FirstPersonControls({ 
  onShoot, 
  showCrosshairs, 
  audioRefs, 
  playAudio 
}: { 
  onShoot?: (origin: THREE.Vector3, direction: THREE.Vector3) => void; 
  showCrosshairs: boolean;
  audioRefs: {
    pistolCocking: HTMLAudioElement;
    pistolHolster: HTMLAudioElement;
    gunshot: HTMLAudioElement;
    coinHit: HTMLAudioElement;
  };
  playAudio: (audio: HTMLAudioElement) => Promise<void>;
}) {
  const { camera, gl } = useThree();
  const isLocked = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const keys = useRef({
    w: false, s: false, a: false, d: false,
    shift: false, space: false, r: false
  });
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const onGround = useRef(true);
  const yaw = useRef(0);
  const pitch = useRef(0);

  // Collision boxes for fortress walls
  const colliders = useMemo(() => {
    const cliffW = 40, cliffH = 20, frontT = 2;
    const courtyardDepth = 30, frontZ = -8;
    const openingHalfW = 2;
    
    return [
      // Left pillar
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2, 0, frontZ - frontT/2),
        new THREE.Vector3(-cliffW/4 - openingHalfW/2 + (cliffW/2 - openingHalfW)/2, cliffH, frontZ + frontT/2)
      ),
      // Right pillar  
      new THREE.Box3(
        new THREE.Vector3(cliffW/4 + openingHalfW/2 - (cliffW/2 - openingHalfW)/2, 0, frontZ - frontT/2),
        new THREE.Vector3(cliffW/2, cliffH, frontZ + frontT/2)
      ),
      // Side walls
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
        new THREE.Vector3(-cliffW/2 + 1, cliffH, frontZ - frontT)
      ),
      new THREE.Box3(
        new THREE.Vector3(cliffW/2 - 1, 0, frontZ - courtyardDepth - frontT),
        new THREE.Vector3(cliffW/2 + 1, cliffH, frontZ - frontT)
      ),
      // Back wall
      new THREE.Box3(
        new THREE.Vector3(-cliffW/2, 0, frontZ - courtyardDepth - frontT - 1),
        new THREE.Vector3(cliffW/2, cliffH, frontZ - courtyardDepth - frontT + 1)
      )
    ];
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.current.w = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.current.s = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.current.a = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.current.d = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.current.shift = true;
        break;
      case 'Space':
        keys.current.space = true;
        event.preventDefault();
        break;
      case 'KeyR':
        const newCrosshairsState = !crosshairsEnabled;
        setCrosshairsEnabled(newCrosshairsState);
        
        // Dispatch custom event to notify parent component
        const crosshairEvent = new CustomEvent('crosshairChange', { 
          detail: { enabled: newCrosshairsState } 
        });
        window.dispatchEvent(crosshairEvent);
        
        // Play appropriate gun sound using preloaded audio
        const audio = newCrosshairsState ? audioRefs.pistolCocking : audioRefs.pistolHolster;
        playAudio(audio);
        break;
      case 'Escape':
        if (isLocked.current) {
          document.exitPointerLock();
        }
        break;
    }
  }, [crosshairsEnabled]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.current.w = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.current.s = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.current.a = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.current.d = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.current.shift = false;
        break;
      case 'Space':
        keys.current.space = false;
        break;
    }
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isLocked.current) return;
    
    const sensitivity = 0.002;
    yaw.current -= event.movementX * sensitivity;
    pitch.current -= event.movementY * sensitivity;
    
    const maxPitch = Math.PI / 2 - 0.01;
    pitch.current = Math.max(-maxPitch, Math.min(maxPitch, pitch.current));
    
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
  }, [camera]);

  const handleClick = useCallback(() => {
    if (!isLocked.current) {
      gl.domElement.requestPointerLock();
    } else if (crosshairsEnabled && onShoot) {
      // Fire bullet
      const shootDirection = new THREE.Vector3(0, 0, -1);
      shootDirection.applyQuaternion(camera.quaternion);
      onShoot(camera.position.clone(), shootDirection);
      
      // Play gunshot sound using preloaded audio
      playAudio(audioRefs.gunshot);
    }
  }, [gl, crosshairsEnabled, onShoot, camera]);

  const handlePointerLockChange = useCallback(() => {
    isLocked.current = document.pointerLockElement === gl.domElement;
  }, [gl]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    gl.domElement.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [handleKeyDown, handleKeyUp, handleMouseMove, handlePointerLockChange, handleClick, gl.domElement]);

  useFrame((state, delta) => {
    // Movement input
    direction.current.set(0, 0, 0);
    if (keys.current.w) direction.current.z += 1;
    if (keys.current.s) direction.current.z -= 1;
    if (keys.current.a) direction.current.x -= 1;
    if (keys.current.d) direction.current.x += 1;
    direction.current.normalize();

    // Speed calculation
    const baseSpeed = 4.0;
    const runSpeed = keys.current.shift ? 8.0 : baseSpeed;
    
    // Apply movement
    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    
    const deltaMovement = new THREE.Vector3();
    deltaMovement.addScaledVector(forward, direction.current.z * runSpeed * delta);
    deltaMovement.addScaledVector(right, direction.current.x * runSpeed * delta);

    // Gravity and jumping
    velocity.current.y -= 9.8 * delta;
    if (keys.current.space && onGround.current) {
      velocity.current.y = 5.5;
      onGround.current = false;
    }
    deltaMovement.y += velocity.current.y * delta;

    // Store previous position for collision detection
    const prevPosition = camera.position.clone();
    camera.position.add(deltaMovement);

    // Ground collision
    if (camera.position.y < 1.6) {
      camera.position.y = 1.6;
      velocity.current.y = 0;
      onGround.current = true;
    } else {
      onGround.current = false;
    }

    // Wall collision detection
    for (const collider of colliders) {
      if (collider.containsPoint(camera.position)) {
        camera.position.copy(prevPosition);
        velocity.current.y = 0;
        break;
      }
    }
  });

  return null;
}

// Waterfall component matching original exactly
function Waterfall({ flowSpeed = 1.2, dropCount = 6000, colorPalette }: { 
  flowSpeed: number; 
  dropCount: number; 
  colorPalette: Array<{ hex: string; weight: number; }>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Float32Array>();
  const prevDropCount = useRef(dropCount);
  
  const fall = {
    width: 4,
    depth: 0.6,
    topY: 19.95, // cliffH - 0.05
    bottomY: 0.2,
    centerX: 0,
    z: -5.95 // frontZ + frontT/2 + 0.05
  };

  // Water drop colors from props
  const palette = useMemo(() => {
    // Calculate total weight to normalize
    const totalWeight = colorPalette.reduce((sum, item) => sum + item.weight, 0);
    return colorPalette.map(item => ({
      hex: item.hex,
      weight: totalWeight > 0 ? item.weight / totalWeight : 0
    }));
  }, [colorPalette]);

  // Create cumulative distribution function (matching original)
  const cdf = useMemo(() => {
    const result = [];
    let sum = 0;
    for (const p of palette) {
      sum += p.weight;
      result.push(sum);
    }
    for (let i = 0; i < result.length; i++) {
      result[i] /= sum;
    }
    return result;
  }, []);

  const pickColor = useCallback(() => {
    const r = Math.random();
    for (let i = 0; i < cdf.length; i++) {
      if (r <= cdf[i]) {
        const color = new THREE.Color(palette[i].hex);
        // Darken colors to compensate for additive blending and lighting
        color.multiplyScalar(0.4);
        return color;
      }
    }
    const color = new THREE.Color(palette[palette.length - 1].hex);
    color.multiplyScalar(0.4);
    return color;
  }, [cdf, palette]);

  // Halton sequence for better distribution (from original)
  const halton = useCallback((i: number, base: number) => {
    let f = 1;
    let result = 0;
    while (i > 0) {
      f /= base;
      result += f * (i % base);
      i = Math.floor(i / base);
    }
    return result;
  }, []);

  // Recreate drops when count changes with even time distribution
  useEffect(() => {
    if (prevDropCount.current !== dropCount) {
      prevDropCount.current = dropCount;
      
      if (pointsRef.current) {
        // Dispose old geometry
        pointsRef.current.geometry.dispose();
        
        // Create new geometry
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(dropCount * 3);
        const colors = new Float32Array(dropCount * 3);
        
        // Create new velocities array
        velocitiesRef.current = new Float32Array(dropCount);
        
        const rangeY = fall.topY - fall.bottomY;
        
        for (let i = 0; i < dropCount; i++) {
          // Use proper random distribution for X and Z to avoid clustering
          const u = Math.random();
          const v = Math.random();
          
          // Use time-based distribution for Y position
          const timeOffset = (i / dropCount) * 2; // 2 second spread
          const fallTime = Math.sqrt(2 * rangeY / (9.8 * flowSpeed));
          const progress = (timeOffset % fallTime) / fallTime;
          
          positions[i * 3] = fall.centerX + (u - 0.5) * fall.width;
          positions[i * 3 + 1] = fall.topY - progress * rangeY;
          positions[i * 3 + 2] = fall.z + (v - 0.5) * fall.depth;
          
          const color = pickColor();
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
          
          // Initialize velocity based on progress
          velocitiesRef.current[i] = Math.sqrt(2 * 9.8 * flowSpeed * progress * rangeY);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsRef.current.geometry = geometry;
      }
    }
  }, [dropCount, halton, pickColor, flowSpeed]);

  // Initial setup with time-based distribution for smooth flow
  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(dropCount * 3);
    const colors = new Float32Array(dropCount * 3);
    
    velocitiesRef.current = new Float32Array(dropCount);
    
    const rangeY = fall.topY - fall.bottomY;
    
    for (let i = 0; i < dropCount; i++) {
      // Use proper random distribution for X and Z to avoid clustering
      const u = Math.random();
      const v = Math.random();
      
      // Use time-based distribution for Y position instead of random height
      // This creates an even flow by spacing drops based on their fall time
      const timeOffset = (i / dropCount) * 2; // 2 second spread
      const fallTime = Math.sqrt(2 * rangeY / (9.8 * flowSpeed));
      const progress = (timeOffset % fallTime) / fallTime;
      
      positions[i * 3] = fall.centerX + (u - 0.5) * fall.width;
      positions[i * 3 + 1] = fall.topY - progress * rangeY; // Even distribution over time
      positions[i * 3 + 2] = fall.z + (v - 0.5) * fall.depth;
      
      const color = pickColor();
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      // Initialize velocity based on progress through fall
      velocitiesRef.current[i] = Math.sqrt(2 * 9.8 * flowSpeed * progress * rangeY);
    }
    
    return { positions, colors };
  }, []);

  useFrame((state, delta) => {
    if (!pointsRef.current || !velocitiesRef.current) return;
    
    const positionAttribute = pointsRef.current.geometry.attributes.position;
    const colorAttribute = pointsRef.current.geometry.attributes.color;
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;
    
    // Match original physics exactly
    const gravity = 9.8 * flowSpeed;
    
    for (let i = 0; i < dropCount; i++) {
      velocitiesRef.current[i] += gravity * delta;
      let y = positions[i * 3 + 1] - velocitiesRef.current[i] * delta;
      
      if (y <= fall.bottomY) {
        // Reset drop exactly like original
        positions[i * 3] = fall.centerX + (Math.random() - 0.5) * fall.width;
        y = fall.topY - Math.random() * 0.3;
        positions[i * 3 + 2] = fall.z + (Math.random() - 0.5) * fall.depth;
        velocitiesRef.current[i] = 0;
        
        // Pick new color with darkening compensation
        const color = pickColor();
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        colorAttribute.needsUpdate = true;
      }
      
      positions[i * 3 + 1] = y;
    }
    
    positionAttribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={dropCount}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={dropCount}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.16}
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        depthTest={true}
        blending={THREE.NormalBlending}
        alphaTest={0.1}
      />
    </points>
  );
}

// Fortress structure
function Fortress() {
  const cliffW = 40, cliffH = 20, frontT = 2;
  const courtyardDepth = 30, frontZ = -8;
  const openingHalfW = 2, openingH = 5;

  // Load textures
  const cliffTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('/cliff_texture_seamless.webp');
  }, []);

  // Create individual textures for each wall with proper scaling
  const frontTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.6, 4); // (cliffW/2 - openingHalfW) / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const topTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.8, 3); // (openingHalfW*2) / 5, (cliffH-openingH) / 5
    return texture;
  }, [cliffTexture]);

  const sideTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4); // courtyardDepth / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const backTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 4); // cliffW / 5, cliffH / 5
    return texture;
  }, [cliffTexture]);

  const grassTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('/grass_texture_seamless.webp');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    return texture;
  }, []);

  return (
    <group>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial map={grassTexture} metalness={0} roughness={1} />
      </mesh>

      {/* Front wall - Left pillar (extended to connect with side wall) */}
      <mesh position={[-(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Right pillar (extended to connect with side wall) */}
      <mesh position={[(cliffW/2 + openingHalfW)/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Top piece above opening */}
      <mesh position={[0, openingH + (cliffH-openingH)/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[openingHalfW*2, cliffH-openingH, frontT]} />
        <meshStandardMaterial map={topTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Left wall (adjusted to connect properly) */}
      <mesh position={[-cliffW/2 + 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Right wall (adjusted to connect properly) */}
      <mesh position={[cliffW/2 - 1, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, cliffH/2, frontZ - courtyardDepth - frontT]} castShadow receiveShadow>
        <boxGeometry args={[cliffW, cliffH, 2]} />
        <meshStandardMaterial map={backTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Courtyard floor */}
      <mesh 
        position={[0, 0.01, frontZ - courtyardDepth/2 - frontT/2]} 
        rotation={[-Math.PI/2, 0, 0]} 
        receiveShadow
      >
        <planeGeometry args={[cliffW-4, courtyardDepth-2]} />
        <meshStandardMaterial 
          map={(() => {
            const texture = grassTexture.clone();
            // Calculate repeat based on the same scale as main ground (260x260 with 20x20 repeat = 13 units per repeat)
            // For courtyard: (cliffW-4) = 36, (courtyardDepth-2) = 28
            texture.repeat.set((cliffW-4)/13, (courtyardDepth-2)/13);
            return texture;
          })()} 
          metalness={0} 
          roughness={1} 
        />
      </mesh>
    </group>
  );
}

// Coins component using sprites like the original
function Coins({ coinRate = 60, coinSize = 1.2, flowSpeed = 1.2, onGetCoins }: { 
  coinRate: number; 
  coinSize: number; 
  flowSpeed: number; 
  onGetCoins?: () => { position: THREE.Vector3; visible: boolean; mesh: THREE.Sprite | null }[];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coinAccumulator = useRef(0);
  const maxCoins = 800; // Match original
  
  // Load coin texture
  const coinTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('/waterfall_coin.png');
  }, []);
  
  const coins = useMemo(() => {
    const coinsArray = [];
    for (let i = 0; i < maxCoins; i++) {
      coinsArray.push({
        position: new THREE.Vector3(0, 20, -6 + (Math.random() - 0.5) * 0.6), // Start at fortress height
        velocity: 0,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * Math.PI * 2,
        scaleJitter: 1 + (Math.random() * 0.4 - 0.2),
        visible: false,
        mesh: null as THREE.Sprite | null
      });
    }
    return coinsArray;
  }, [maxCoins]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // Spawn coins exactly like original
    coinAccumulator.current += coinRate * delta;
    while (coinAccumulator.current >= 1) {
      const availableCoin = coins.find(c => !c.visible);
      if (availableCoin) {
        availableCoin.visible = true;
        availableCoin.position.set(
          (Math.random() - 0.5) * 4, // fall.width
          20, // Start at fortress height
          -6 + (Math.random() - 0.5) * 0.6 // fall.z + fall.depth
        );
        availableCoin.velocity = 0;
        availableCoin.rotation = Math.random() * Math.PI * 2;
        availableCoin.rotSpeed = (Math.random() * 2 - 1) * Math.PI * 2;
      }
      coinAccumulator.current -= 1;
    }

    // Update coin physics exactly like original
    const gravity = 9.8 * flowSpeed;
    coins.forEach((coin) => {
      if (!coin.visible || !coin.mesh) return;
      
      coin.velocity += gravity * delta;
      coin.position.y -= coin.velocity * delta;
      coin.rotation += coin.rotSpeed * delta;
      
      // Update mesh position and rotation
      coin.mesh.position.copy(coin.position);
      coin.mesh.material.rotation = coin.rotation;
      
      if (coin.position.y <= 0.2) {
        coin.visible = false;
        // Remove from rendering by clearing mesh reference
        if (coin.mesh) {
          coin.mesh.visible = false;
        }
      }
    });
  });

  // Expose coins for bullet collision detection
  useEffect(() => {
    if (onGetCoins) {
      (window as any).getCoins = () => coins;
    }
  }, [coins, onGetCoins]);

  return (
    <group ref={groupRef}>
      {coins.map((coin, index) => 
        coin.visible && (
          <sprite 
            key={index} 
            ref={(ref) => { 
              coin.mesh = ref; 
              if (ref) ref.visible = true;
            }}
            position={[coin.position.x, coin.position.y, coin.position.z]} 
            scale={[coinSize * coin.scaleJitter, coinSize * coin.scaleJitter, 1]}
          >
            <spriteMaterial map={coinTexture} transparent />
          </sprite>
        )
      )}
    </group>
  );
}

// Bullets component with collision detection and audio
function Bullets({ bullets }: { 
  bullets: Array<{ 
    position: THREE.Vector3; 
    direction: THREE.Vector3; 
    speed: number; 
    life: number; 
  }>; 
}) {
  return (
    <group>
      {bullets.map((bullet, index) => (
        <mesh key={index} position={[bullet.position.x, bullet.position.y, bullet.position.z]}>
          <sphereGeometry args={[0.05]} />
          <meshBasicMaterial color="#ffff00" />
        </mesh>
      ))}
    </group>
  );
}

// Scene component
// Scene component with audio management
function Scene({ settings, onCoinHit }: { settings: any; onCoinHit: (position: THREE.Vector3) => void }) {
  const [bullets, setBullets] = useState<Array<{ position: THREE.Vector3; direction: THREE.Vector3; speed: number; life: number }>>([]);
  const [showCrosshairs, setShowCrosshairs] = useState(false);

  // Audio context and preloaded audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRefs = useRef({
    pistolCocking: new Audio('/pistol_cocking_sound.mp3'),
    pistolHolster: new Audio('/holster_pistol_sound.mp3'),
    gunshot: new Audio('/space_gunshot.mp3'),
    coinHit: new Audio('/coin_hit_sound.mp3')
  });

  // Initialize audio context and preload sounds
  useEffect(() => {
    // Create audio context for managing audio state
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }

    // Set volumes for preloaded audio
    audioRefs.current.pistolCocking.volume = 0.5;
    audioRefs.current.pistolHolster.volume = 0.5;
    audioRefs.current.gunshot.volume = 0.3;
    audioRefs.current.coinHit.volume = 0.4;

    // Preload all audio files
    Object.values(audioRefs.current).forEach(audio => {
      audio.preload = 'auto';
      audio.load();
    });

    return () => {
      // Cleanup audio context
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Function to resume audio context if suspended
  const resumeAudioContext = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch (e) {
        console.warn('Failed to resume audio context:', e);
      }
    }
  }, []);

  // Safe audio play function
  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    try {
      await resumeAudioContext();
      audio.currentTime = 0;
      await audio.play();
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }, [resumeAudioContext]);

  const handleShoot = useCallback((origin: THREE.Vector3, direction: THREE.Vector3) => {
    setBullets(prev => [...prev, {
      position: origin.clone(),
      direction: direction.clone(),
      speed: 100,
      life: 3.0
    }]);
    setShowCrosshairs(true);
  }, []);

  // Audio callback for coin hits
  const handleCoinHitSound = useCallback(() => {
    playAudio(audioRefs.current.coinHit);
  }, [playAudio]);

  useFrame((state, delta) => {
    setBullets(prev => {
      const newBullets = [];
      
      for (const bullet of prev) {
        bullet.position.addScaledVector(bullet.direction, bullet.speed * delta);
        bullet.life -= delta;
        
        if (bullet.life > 0) {
          // Check collision with coins
          const coins = (window as any).getCoins ? (window as any).getCoins() : [];
          let hit = false;
          
          for (const coin of coins) {
            if (coin.visible && coin.mesh) {
              const distance = bullet.position.distanceTo(coin.position);
              if (distance < 0.8) { // Collision threshold
                coin.visible = false;
                if (coin.mesh) coin.mesh.visible = false;
                onCoinHit(coin.position.clone());
                hit = true;
                
                // Play coin hit sound using parent's audio system
                handleCoinHitSound();
                break;
              }
            }
          }
          
          if (!hit) {
            newBullets.push(bullet);
          }
        }
      }
      
      return newBullets;
    });
  });

  return (
    <>
      <FirstPersonControls 
        onShoot={handleShoot} 
        showCrosshairs={true}
        audioRefs={audioRefs.current}
        playAudio={playAudio}
      />
      
      {/* Lighting */}
      <hemisphereLight args={['#ffffff', '#edfff6', 1.1]} />
      <directionalLight
        position={[35, 45, 15]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <ambientLight intensity={0.25} />

      {/* HDRI Sky */}
      <SkyTexture />

      {/* Fog */}
      <fog attach="fog" args={['#dff1ff', 0, 600]} />

      {/* Scene objects */}
      <Fortress />
      <BillboardWalls />
      <Waterfall 
        flowSpeed={settings.flowSpeed} 
        dropCount={settings.dropCount} 
        colorPalette={settings.colorPalette} 
      />
      <Coins 
        coinRate={settings.coinRate} 
        coinSize={settings.coinSize} 
        flowSpeed={settings.flowSpeed}
        onGetCoins={() => []}
      />
      <Bullets bullets={bullets} />
    </>
  );
}

// Collapsible control panel component
function ControlPanel({ settings, onSettingsChange, isVisible }: { 
  settings: any; 
  onSettingsChange: (key: string, value: any) => void;
  isVisible: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-4 z-20 space-y-4 max-w-md">
      <Card className="waterfall-card">
        <div 
          className="flex items-center justify-between mb-3 cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <h3 className="font-bold text-sm">WATERFALL & COINS</h3>
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
        
        {!isCollapsed && (
          <div className="space-y-3 animate-fade-in">
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Flow speed</Label>
              <Slider
                value={[settings.flowSpeed]}
                onValueChange={([value]) => onSettingsChange('flowSpeed', value)}
                min={0.2}
                max={3}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.flowSpeed.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Drops count</Label>
              <Slider
                value={[settings.dropCount]}
                onValueChange={([value]) => onSettingsChange('dropCount', value)}
                min={500}
                max={15000}
                step={100}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.dropCount}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin rate (ps)</Label>
              <Slider
                value={[settings.coinRate]}
                onValueChange={([value]) => onSettingsChange('coinRate', value)}
                min={0}
                max={10}
                step={1}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinRate}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin size</Label>
              <Slider
                value={[settings.coinSize]}
                onValueChange={([value]) => onSettingsChange('coinSize', value)}
                min={0.2}
                max={1}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinSize.toFixed(2)}</span>
            </div>
            
            {/* Color/Weight Controls */}
            <div className="mt-4 space-y-2">
              <Label className="text-xs opacity-85 font-semibold">Drop Colors & Weights</Label>
              <div className="grid grid-cols-3 gap-2">
                {settings.colorPalette.map((colorWeight, index) => (
                  <div key={index} className="flex items-center gap-1 text-xs">
                    <div 
                      className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: colorWeight.hex }}
                    />
                    <Input
                      type="color"
                      value={colorWeight.hex}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], hex: e.target.value };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-6 h-6 p-0 border-0 cursor-pointer flex-shrink-0"
                    />
                    <Input
                      type="number"
                      value={colorWeight.weight}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], weight: parseInt(e.target.value) || 0 };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-12 h-6 text-xs p-1 flex-1"
                      min="0"
                      max="100"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 text-xs opacity-75">
              Click to lock mouse • WASD move • Shift run • Space jump • ESC unlock
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// Main Waterfall Fortress component
export default function WaterfallFortress() {
  // Default color/weight pairs - 6 colors as requested
  const defaultColorPalette = [
    { hex: '#06c8c0', weight: 10 },
    { hex: '#028eef', weight: 10 },
    { hex: '#194ca8', weight: 20 },
    { hex: '#18488a', weight: 30 },
    { hex: '#103d6a', weight: 30 },
    { hex: '#0a2847', weight: 15 }
  ];

  const [settings, setSettings] = useState({
    flowSpeed: 1.2,
    dropCount: 6000,
    coinRate: 6,
    coinSize: 0.8,
    colorPalette: defaultColorPalette
  });
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);

  const handleSettingsChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleCoinHit = useCallback((position: THREE.Vector3) => {
    setCoinScore(prev => prev + 1);
  }, []);

  // Listen for crosshair state changes from FirstPersonControls
  useEffect(() => {
    const handleCrosshairChange = (event: CustomEvent) => {
      setCrosshairsEnabled(event.detail.enabled);
    };

    window.addEventListener('crosshairChange', handleCrosshairChange as EventListener);
    return () => {
      window.removeEventListener('crosshairChange', handleCrosshairChange as EventListener);
    };
  }, []);

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
      <Scene settings={settings} onCoinHit={handleCoinHit} />
    </Canvas>

    {/* Panel visibility toggle button */}
    <Button
      className="fixed top-4 right-4 z-30 waterfall-button"
      size="sm"
      onClick={() => setPanelsVisible(!panelsVisible)}
    >
      {panelsVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
    
    <ControlPanel 
      settings={settings} 
      onSettingsChange={handleSettingsChange}
      isVisible={panelsVisible}
    />
    
    {/* Billboard Control Panel - positioned below the Waterfall panel */}
    <div className="fixed top-4 left-4 z-20 space-y-4 max-w-md" style={{ marginTop: '320px' }}>
      <BillboardControlPanel isVisible={panelsVisible} />
    </div>
    
    {/* Score display */}
    <div className="fixed bottom-4 left-4 z-20 flex items-center gap-2 bg-black/50 text-white p-2 rounded">
      <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
      <span className="font-bold">x{coinScore}</span>
    </div>
    
    {/* Instructions */}
    {panelsVisible && (
      <div className="fixed bottom-4 right-4 z-20 text-white text-sm bg-black/50 p-2 rounded">
        Press R for crosshairs • Click to shoot
      </div>
    )}
    
    {/* Crosshair - conditional class for active state */}
    <div className={`waterfall-crosshair ${crosshairsEnabled ? 'active' : ''}`} />
    </div>
  );
}