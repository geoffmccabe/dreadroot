// Draws + simulates all active spray particles. One InstancedMesh per sprite shape
// (camera-billboarded quads, per-instance color + size). Runs the sim each frame
// against the player (camera) and plays a short, velocity-scaled impact sound on hit.
// Mount once in the siege scene; it's idle (count 0) until a monster fires.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { updateSpray, getSprayParticles } from './sprayAttackSystem';
import { getSprayShapeTexture } from './sprayShapes';
import type { SpraySprite } from './sprayConfig';
import { playSpatialSound } from '@/lib/spatialAudio';

const SHAPES: SpraySprite[] = ['circle', 'oval', 'diamond', 'line', 'square', 'star'];
const PER = 500;  // max instances per shape

export function SprayAttackRenderer() {
  const camera = useThree((s) => s.camera);
  const meshes = useRef<Record<string, THREE.InstancedMesh>>({});
  const lastSound = useRef(0);

  const group = useMemo(() => {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const sh of SHAPES) {
      const mat = new THREE.MeshBasicMaterial({
        map: getSprayShapeTexture(sh), transparent: true, depthWrite: false, toneMapped: false,
      });
      const im = new THREE.InstancedMesh(geo, mat, PER);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      meshes.current[sh] = im;
      g.add(im);
    }
    return g;
  }, []);

  const _m = useMemo(() => new THREE.Matrix4(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);
  const _c = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    const onHit = (vol: number, cfg: { soundUrl: string; soundClipStart: number; soundClipDur: number }) => {
      const now = performance.now();
      if (now - lastSound.current < 18) return;   // dense splatter without audio overload
      lastSound.current = now;
      playSpatialSound(cfg.soundUrl, 0, {
        baseVolume: Math.max(0.04, vol), clipStart: cfg.soundClipStart, clipDur: cfg.soundClipDur,
        playbackRate: 0.85 + Math.random() * 0.4,
      });
    };
    updateSpray(Math.min(dt, 0.05), camera.position.x, camera.position.y, camera.position.z, onHit);

    const ps = getSprayParticles();
    const counts: Record<string, number> = {};
    for (const sh of SHAPES) counts[sh] = 0;
    const q = camera.quaternion;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const im = meshes.current[p.shape];
      const idx = counts[p.shape];
      if (idx >= PER) continue;
      _p.set(p.x, p.y, p.z);
      _s.set(p.size * 2, p.size * 2, p.size * 2);
      _m.compose(_p, q, _s);
      im.setMatrixAt(idx, _m);
      im.setColorAt(idx, _c.setRGB(p.r, p.g, p.b));
      counts[p.shape] = idx + 1;
    }
    for (const sh of SHAPES) {
      const im = meshes.current[sh];
      im.count = counts[sh];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  });

  return <primitive object={group} />;
}
