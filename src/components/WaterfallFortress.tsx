import React, { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

// Waterfall component
function Waterfall({ flowSpeed = 1.2, dropCount = 6000 }: { flowSpeed: number; dropCount: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const velocities = useRef<Float32Array>(new Float32Array(dropCount));
  
  const fall = {
    width: 4,
    depth: 0.6,
    topY: 19.95,
    bottomY: 0.2,
    centerX: 0,
    z: -5.95
  };

  // Water drop colors (matching original palette)
  const palette = [
    { hex: '#06c8c0', weight: 0.10 },
    { hex: '#028eef', weight: 0.10 },
    { hex: '#194ca8', weight: 0.20 },
    { hex: '#18488a', weight: 0.30 },
    { hex: '#103d6a', weight: 0.30 }
  ];

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(dropCount * 3);
    const colors = new Float32Array(dropCount * 3);
    
    // Create cumulative distribution for color picking
    const cdf = [];
    let sum = 0;
    for (const p of palette) {
      sum += p.weight;
      cdf.push(sum);
    }
    for (let i = 0; i < cdf.length; i++) {
      cdf[i] /= sum;
    }

    const pickColor = () => {
      const r = Math.random();
      for (let i = 0; i < cdf.length; i++) {
        if (r <= cdf[i]) return new THREE.Color(palette[i].hex);
      }
      return new THREE.Color(palette[palette.length - 1].hex);
    };

    // Halton sequence for better distribution
    const halton = (i: number, base: number) => {
      let result = 0;
      let f = 1;
      while (i > 0) {
        f /= base;
        result += f * (i % base);
        i = Math.floor(i / base);
      }
      return result;
    };

    const rangeY = fall.topY - fall.bottomY;
    
    for (let i = 0; i < dropCount; i++) {
      const u = halton(i + 1, 2);
      const v = halton(i + 1, 3);
      const w = halton(i + 1, 5);
      
      positions[i * 3] = fall.centerX + (u - 0.5) * fall.width;
      positions[i * 3 + 1] = fall.bottomY + w * rangeY;
      positions[i * 3 + 2] = fall.z + (v - 0.5) * fall.depth;
      
      const color = pickColor();
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      velocities.current[i] = 0;
    }
    
    return { positions, colors };
  }, [dropCount]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    
    const positionAttribute = pointsRef.current.geometry.attributes.position;
    const colorAttribute = pointsRef.current.geometry.attributes.color;
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;
    
    const gravity = 9.8 * flowSpeed;
    
    for (let i = 0; i < dropCount; i++) {
      velocities.current[i] += gravity * delta;
      let y = positions[i * 3 + 1] - velocities.current[i] * delta;
      
      if (y <= fall.bottomY) {
        // Reset drop
        positions[i * 3] = fall.centerX + (Math.random() - 0.5) * fall.width;
        y = fall.topY - Math.random() * 0.3;
        positions[i * 3 + 2] = fall.z + (Math.random() - 0.5) * fall.depth;
        velocities.current[i] = 0;
        
        // New color
        const colorIdx = Math.floor(Math.random() * palette.length);
        const color = new THREE.Color(palette[colorIdx].hex);
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
        opacity={1.0}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Fortress structure
function Fortress() {
  const cliffW = 40, cliffH = 20, frontT = 2;
  const courtyardDepth = 30, frontZ = -8;
  const openingHalfW = 2, openingH = 5;

  return (
    <group>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color="#4a7c59" metalness={0} roughness={1} />
      </mesh>

      {/* Fortress walls */}
      {/* Left pillar */}
      <mesh position={[-cliffW/4 - openingHalfW/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Right pillar */}
      <mesh position={[cliffW/4 + openingHalfW/2, cliffH/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW/2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Header */}
      <mesh position={[0, openingH + (cliffH-openingH)/2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[openingHalfW*2, cliffH-openingH, frontT]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Side walls */}
      <mesh position={[-cliffW/2, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      <mesh position={[cliffW/2, cliffH/2, frontZ - courtyardDepth/2 - frontT/2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, cliffH/2, frontZ - courtyardDepth - frontT]} castShadow receiveShadow>
        <boxGeometry args={[cliffW, cliffH, 2]} />
        <meshStandardMaterial color="#8f98a5" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Courtyard floor */}
      <mesh 
        position={[0, 0.01, frontZ - courtyardDepth/2 - frontT/2]} 
        rotation={[-Math.PI/2, 0, 0]} 
        receiveShadow
      >
        <planeGeometry args={[cliffW-4, courtyardDepth-2]} />
        <meshStandardMaterial color="#4a7c59" metalness={0} roughness={1} />
      </mesh>
    </group>
  );
}

// Coins component
function Coins({ coinRate = 60, coinSize = 1.2, flowSpeed = 1.2 }: { coinRate: number; coinSize: number; flowSpeed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const coinAccumulator = useRef(0);
  const maxCoins = 200; // Reduced for better performance
  
  const coins = useMemo(() => {
    const coinsArray = [];
    for (let i = 0; i < maxCoins; i++) {
      coinsArray.push({
        position: [0, 20 + Math.random() * 2, -6 + (Math.random() - 0.5) * 0.6] as [number, number, number],
        velocity: 0,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * Math.PI * 2,
        scale: coinSize * (1 + (Math.random() * 0.4 - 0.2)),
        visible: false
      });
    }
    return coinsArray;
  }, [coinSize, maxCoins]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // Spawn coins
    coinAccumulator.current += coinRate * delta;
    while (coinAccumulator.current >= 1) {
      const availableCoin = coins.find(c => !c.visible);
      if (availableCoin) {
        availableCoin.visible = true;
        availableCoin.position = [
          (Math.random() - 0.5) * 4,
          20 + Math.random() * 2,
          -6 + (Math.random() - 0.5) * 0.6
        ];
        availableCoin.velocity = 0;
        availableCoin.rotation = Math.random() * Math.PI * 2;
      }
      coinAccumulator.current -= 1;
    }

    // Update coin physics
    const gravity = 9.8 * flowSpeed;
    coins.forEach((coin, index) => {
      if (!coin.visible) return;
      
      coin.velocity += gravity * delta;
      coin.position[1] -= coin.velocity * delta;
      coin.rotation += coin.rotSpeed * delta;
      
      if (coin.position[1] <= 0.2) {
        coin.visible = false;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {coins.map((coin, index) => 
        coin.visible && (
          <mesh key={index} position={coin.position} scale={[coin.scale, coin.scale, 0.1]} rotation={[0, 0, coin.rotation]}>
            <circleGeometry args={[0.5, 8]} />
            <meshStandardMaterial color="#ffd700" metalness={0.8} roughness={0.2} />
          </mesh>
        )
      )}
    </group>
  );
}

// Scene component
function Scene({ settings }: { settings: any }) {
  return (
    <>
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

      {/* Sky dome */}
      <mesh scale={[320, 320, 320]}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial color="#dff1ff" side={THREE.BackSide} />
      </mesh>

      {/* Fog */}
      <fog attach="fog" args={['#dff1ff', 0, 600]} />

      {/* Scene objects */}
      <Fortress />
      <Waterfall flowSpeed={settings.flowSpeed} dropCount={settings.dropCount} />
      <Coins coinRate={settings.coinRate} coinSize={settings.coinSize} flowSpeed={settings.flowSpeed} />
    </>
  );
}

// Control panel component
function ControlPanel({ settings, onSettingsChange }: { settings: any; onSettingsChange: (key: string, value: any) => void }) {
  return (
    <div className="fixed top-4 left-4 z-20 space-y-4 max-w-md">
      <Card className="waterfall-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">WATERFALL & COINS</h3>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
            <Label className="text-xs opacity-85">Flow speed</Label>
            <Slider
              value={[settings.flowSpeed]}
              onValueChange={([value]) => onSettingsChange('flowSpeed', value)}
              min={0.2}
              max={3}
              step={0.01}
              className="flex-1"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
            <Label className="text-xs opacity-85">Drops count</Label>
            <Slider
              value={[settings.dropCount]}
              onValueChange={([value]) => onSettingsChange('dropCount', value)}
              min={500}
              max={10000}
              step={100}
              className="flex-1"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
            <Label className="text-xs opacity-85">Coin rate (ps)</Label>
            <Slider
              value={[settings.coinRate]}
              onValueChange={([value]) => onSettingsChange('coinRate', value)}
              min={0}
              max={150}
              step={1}
              className="flex-1"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
            <Label className="text-xs opacity-85">Coin size</Label>
            <Slider
              value={[settings.coinSize]}
              onValueChange={([value]) => onSettingsChange('coinSize', value)}
              min={0.2}
              max={3}
              step={0.01}
              className="flex-1"
            />
          </div>
        </div>
        <div className="mt-3 text-xs opacity-75">
          Click and drag to rotate • Scroll to zoom • Right-click to pan
        </div>
      </Card>
    </div>
  );
}

// Main Waterfall Fortress component
export default function WaterfallFortress() {
  const [settings, setSettings] = useState({
    flowSpeed: 1.2,
    dropCount: 3000, // Reduced for better performance
    coinRate: 30,
    coinSize: 1.2
  });

  const handleSettingsChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <Scene settings={settings} />
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={2}
          maxDistance={50}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2}
        />
      </Canvas>
      
      <ControlPanel settings={settings} onSettingsChange={handleSettingsChange} />
      
      {/* Crosshair */}
      <div className="waterfall-crosshair" />
    </div>
  );
}