// Stage-1 in-Canvas visualiser. Initialises the array-texture manager with the live GL
// context, loads synthetic test tiles into layers, and renders a grid of quads each
// sampling ONE layer via a sampler2DArray shader — visual proof the engine works AND
// that we can sample an array texture (the exact path Stage 2 needs). Only mounts when
// the debug panel is open; touches nothing in the live render path.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import { getArrayTextureManager } from '@/lib/arrayTextureManager';
import { arrayDebug, useArrayDebug } from './arrayDebugStore';

// Synthetic test tile → data URL (coloured background + index number).
function makeTile(i: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const hue = (i * 47) % 360;
  ctx.fillStyle = `hsl(${hue},70%,45%)`;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(i), 64, 70);
  return c.toDataURL('image/png');
}

const VERT = `
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uMap;
uniform float uLayer;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uMap, vec3(vUv, uLayer)); }`;

export function ArrayTextureDebug() {
  const { gl, camera } = useThree();
  const snap = useArrayDebug();
  const [tiles, setTiles] = useState<{ layer: number }[]>([]);
  const groupRef = useRef<THREE.Group>(null);
  const lastSeq = useRef(0);

  // Init the manager ONLY when the debug panel is first opened — it allocates a large
  // layer buffer, so we don't pay that for everyone at boot (init is idempotent).
  useEffect(() => { if (snap.open) getArrayTextureManager().init(gl); }, [snap.open, gl]);

  // Publish stats ~2×/sec while open.
  useEffect(() => {
    if (!snap.open) return;
    let t = 0;
    const unreg = frameLoop.register('array-debug-stats', (d) => {
      t += d;
      if (t < 0.5) return;
      t = 0;
      arrayDebug.setStats(getArrayTextureManager().stats());
    }, 70);
    return unreg;
  }, [snap.open]);

  // React to panel commands.
  useEffect(() => {
    if (snap.seq === lastSeq.current || !snap.action) return;
    lastSeq.current = snap.seq;
    const mgr = getArrayTextureManager();
    if (snap.action.type === 'load') {
      const n = Math.max(1, snap.action.n || 24);
      const out: { layer: number }[] = [];
      for (let i = 0; i < n; i++) out.push({ layer: mgr.resolve(makeTile(i)).layer });
      setTiles(out);
    } else if (snap.action.type === 'stress') {
      // Resolve far more than layerCount to force LRU eviction (watch the counter).
      const n = Math.max(1, snap.action.n || 2000);
      for (let i = 0; i < n; i++) mgr.resolve(makeTile(10000 + i));
    } else if (snap.action.type === 'clear') {
      setTiles([]);
    }
    arrayDebug.setStats(mgr.stats());
  }, [snap.seq, snap.action]);

  // Park the grid ~6 units in front of the camera while open.
  useEffect(() => {
    if (!snap.open) return;
    const unreg = frameLoop.register('array-debug-pos', () => {
      const g = groupRef.current;
      if (!g) return;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      g.position.copy(camera.position).addScaledVector(fwd, 6);
      g.quaternion.copy(camera.quaternion);
    }, 36);
    return unreg;
  }, [snap.open, camera]);

  const tex = getArrayTextureManager().getTexture();
  const quads = useMemo(() => {
    if (!tex) return [];
    const cols = 8;
    return tiles.map((t, i) => {
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uMap: { value: tex }, uLayer: { value: t.layer } },
        vertexShader: VERT, fragmentShader: FRAG,
      });
      const x = (i % cols) * 0.42 - (cols - 1) * 0.21;
      const y = -Math.floor(i / cols) * 0.42 + 0.8;
      return { mat, x, y, key: i };
    });
  }, [tiles, tex]);

  useEffect(() => () => { quads.forEach((q) => q.mat.dispose()); }, [quads]);

  if (!snap.open) return null;
  return (
    <group ref={groupRef}>
      {quads.map((q) => (
        <mesh key={q.key} position={[q.x, q.y, 0]} material={q.mat}>
          <planeGeometry args={[0.38, 0.38]} />
        </mesh>
      ))}
    </group>
  );
}
