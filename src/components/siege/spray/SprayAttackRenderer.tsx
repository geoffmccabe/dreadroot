// Draws + simulates all active spray particles. One InstancedMesh per sprite shape
// (camera-billboarded quads, per-instance color + size + opacity). Runs the sim each
// frame against the player (camera) and plays a short sound as each blob leaves the
// mouth. Mount once in the siege scene; it's idle (count 0) until a monster fires.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { updateSpray, getSprayParticles } from './sprayAttackSystem';
import { getSprayShapeTexture } from './sprayShapes';
import type { SpraySprite } from './sprayConfig';
import { playSpatialSound } from '@/lib/spatialAudio';

const SHAPES: SpraySprite[] = ['circle', 'oval', 'diamond', 'line', 'square', 'star'];
const PER = 500;  // max instances per shape

// Inject a per-instance opacity attribute into a MeshBasicMaterial.
function withInstanceOpacity(mat: THREE.MeshBasicMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aOpacity;\nvarying float vOpacity;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOpacity = aOpacity;');
    shader.fragmentShader = 'varying float vOpacity;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vOpacity;');
  };
}

export function SprayAttackRenderer() {
  const camera = useThree((s) => s.camera);
  const meshes = useRef<Record<string, THREE.InstancedMesh>>({});
  const opac = useRef<Record<string, THREE.InstancedBufferAttribute>>({});
  const lastSound = useRef(0);

  const group = useMemo(() => {
    const g = new THREE.Group();
    const base = new THREE.PlaneGeometry(1, 1);
    for (const sh of SHAPES) {
      const geo = base.clone();
      const op = new THREE.InstancedBufferAttribute(new Float32Array(PER), 1);
      op.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOpacity', op);
      const mat = new THREE.MeshBasicMaterial({
        map: getSprayShapeTexture(sh), transparent: true, depthWrite: false, toneMapped: false,
        side: THREE.DoubleSide, alphaTest: 0.05,
      });
      withInstanceOpacity(mat);
      const im = new THREE.InstancedMesh(geo, mat, PER);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      meshes.current[sh] = im;
      opac.current[sh] = op;
      g.add(im);
    }
    return g;
  }, []);

  const _m = useMemo(() => new THREE.Matrix4(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);
  const _c = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    // Sound as each blob leaves the mouth (throttled so a 260-blob spray is a dense
    // splatter, not an audio flood). Volume scales with muzzle speed.
    const onEmit = (vol: number, cfg: { soundUrl: string; soundClipStart: number; soundClipDur: number }) => {
      const now = performance.now();
      if (now - lastSound.current < 20) return;
      lastSound.current = now;
      playSpatialSound(cfg.soundUrl, 0, {
        baseVolume: Math.max(0.04, vol), clipStart: cfg.soundClipStart, clipDur: cfg.soundClipDur,
        playbackRate: 0.85 + Math.random() * 0.4,
      });
    };
    updateSpray(Math.min(dt, 0.05), camera.position.x, camera.position.y, camera.position.z, onEmit);

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
      opac.current[p.shape].array[idx] = p.opacity;
      counts[p.shape] = idx + 1;
    }
    for (const sh of SHAPES) {
      const im = meshes.current[sh];
      im.count = counts[sh];
      im.instanceMatrix.needsUpdate = true;
      opac.current[sh].needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  });

  return <primitive object={group} />;
}
