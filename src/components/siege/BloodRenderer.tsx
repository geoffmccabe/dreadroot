// Draws + simulates the blood spray (features/blood/bloodSystem). Two instanced
// meshes: velocity-aligned teardrop droplets, and flat ground decals that fade out.
// Mount once in the siege scene; idle until a bullseye emits blood.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { updateBlood, getBloodDroplets, getBloodDecals, DEFAULT_BLOOD } from '@/features/blood/bloodSystem';
import { sampleHeight } from './terrainHeight';

const MAX = 1200;
const MAX_DECAL = 400;

// White teardrop on transparent — round head, pointed tail. Tinted per-instance.
function teardropTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 128, 128);
  x.fillStyle = '#fff';
  x.beginPath();
  x.arc(64, 46, 28, 0, Math.PI * 2);          // round head (upper)
  x.fill();
  x.beginPath();
  x.moveTo(37, 50); x.lineTo(64, 120); x.lineTo(91, 50); x.closePath();   // taper to a point
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function withInstanceOpacity(mat: THREE.MeshBasicMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aOpacity;\nvarying float vOpacity;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOpacity = aOpacity;');
    shader.fragmentShader = 'varying float vOpacity;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vOpacity;');
  };
}

export function BloodRenderer() {
  const camera = useThree((s) => s.camera);

  const { group, dropMesh, dropOpac, decalMesh, decalOpac } = useMemo(() => {
    const g = new THREE.Group();
    const tex = teardropTexture();
    const make = (n: number) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      const op = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      op.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOpacity', op);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, toneMapped: false,
        side: THREE.DoubleSide, alphaTest: 0.04,
      });
      withInstanceOpacity(mat);
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      g.add(im);
      return { im, op };
    };
    const drop = make(MAX);
    const dec = make(MAX_DECAL);
    return { group: g, dropMesh: drop.im, dropOpac: drop.op, decalMesh: dec.im, decalOpac: dec.op };
  }, []);

  const _m = useMemo(() => new THREE.Matrix4(), []);
  const _c = useMemo(() => new THREE.Color(), []);
  const vDir = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const xA = useMemo(() => new THREE.Vector3(), []);
  const yA = useMemo(() => new THREE.Vector3(), []);
  const zA = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    updateBlood(Math.min(dt, 0.05), DEFAULT_BLOOD, (x, z) => sampleHeight(x, z));

    // Droplets — velocity-aligned, billboarded around the velocity axis.
    const ds = getBloodDroplets();
    let n = 0;
    for (let i = 0; i < ds.length && n < MAX; i++) {
      const p = ds[i];
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 0.01) vDir.set(p.vx / sp, p.vy / sp, p.vz / sp); else vDir.set(0, 1, 0);
      toCam.set(camera.position.x - p.x, camera.position.y - p.y, camera.position.z - p.z).normalize();
      right.crossVectors(vDir, toCam);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
      normal.crossVectors(right, vDir).normalize();
      const w = p.size, l = p.size * p.ratio;
      xA.copy(right).multiplyScalar(w);
      yA.copy(vDir).multiplyScalar(l);
      zA.copy(normal);
      _m.makeBasis(xA, yA, zA); _m.setPosition(p.x, p.y, p.z);
      dropMesh.setMatrixAt(n, _m);
      dropMesh.setColorAt(n, _c.setRGB(p.r, p.g, p.b));
      dropOpac.array[n] = p.opacity;
      n++;
    }
    dropMesh.count = n;
    dropMesh.instanceMatrix.needsUpdate = true;
    dropOpac.needsUpdate = true;
    if (dropMesh.instanceColor) dropMesh.instanceColor.needsUpdate = true;

    // Decals — flat on the surface, teardrop pointing along the horizontal flight dir, fading.
    const decs = getBloodDecals();
    const tS = performance.now() / 1000;
    let dn = 0;
    for (let i = 0; i < decs.length && dn < MAX_DECAL; i++) {
      const d = decs[i];
      const age = tS - d.born;
      const fade = Math.max(0, 1 - age / d.fade);
      const hm = Math.hypot(d.dirx, d.dirz) || 1;
      const lx = d.dirx / hm, lz = d.dirz / hm;          // long axis (flight dir)
      yA.set(lx, 0, lz).multiplyScalar(d.size * 2.5);    // length
      xA.set(lz, 0, -lx).multiplyScalar(d.size);          // width
      zA.set(d.nx, d.ny, d.nz);
      _m.makeBasis(xA, yA, zA); _m.setPosition(d.x, d.y, d.z);
      decalMesh.setMatrixAt(dn, _m);
      decalMesh.setColorAt(dn, _c.setRGB(d.r, d.g, d.b));
      decalOpac.array[dn] = d.opacity * fade;
      dn++;
    }
    decalMesh.count = dn;
    decalMesh.instanceMatrix.needsUpdate = true;
    decalOpac.needsUpdate = true;
    if (decalMesh.instanceColor) decalMesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={group} />;
}
