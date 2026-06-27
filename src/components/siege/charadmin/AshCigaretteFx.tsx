// AshCigaretteFx — runtime effects for Ash's baked cigarette: the grey ash tip flashes orange-red on
// a "drag" every 5s, and a miniature self-contained smoke wisp (small circles rising, growing,
// fading — same look as our main smoke) drifts up from the tip. Auto-gates: only Ash's model carries
// the 'CigaretteAsh' material + 'CigaretteTip' bone, so it's a harmless no-op for every other
// character. Self-contained (no global effects engine), so it works in BOTH the &&& lineup canvas and
// the Admin → Characters preview canvas.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// soft radial-gradient circle for the smoke puffs (built once, shared)
let SMOKE_TEX: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (SMOKE_TEX) return SMOKE_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,0.85)');
  rg.addColorStop(0.5, 'rgba(255,255,255,0.32)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  SMOKE_TEX = new THREE.CanvasTexture(c);
  return SMOKE_TEX;
}

const N = 22;            // smoke sprite pool (bigger so longer-lived puffs don't starve)
const DRAG_MIN = 6, DRAG_MAX = 10;   // s between drags (random)
const DRAG_LEN = 2.6;    // s the tip glows (up then back to grey)
const RISE = 0.05;       // m/s the smoke floats up (miniature)
const LIFE = 4.8;        // s smoke lifetime
const SPAWN = 0.22;      // s between puffs (faster during a drag)

interface Puff { s: THREE.Sprite; age: number; life: number; vx: number; vz: number }

export function AshCigaretteFx({ group }: { group: THREE.Group }) {
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const tipRef = useRef<THREE.Object3D | null>(null);
  const puffsRef = useRef<Puff[]>([]);
  const spawnAcc = useRef(0);
  const dragStart = useRef(-1);   // time the current drag began (-1 = idle)
  const nextDrag = useRef(-1);    // time the next drag fires (random 6–10s apart)
  const scratch = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    // Isolate the ash material per-instance (SkeletonUtils.clone shares materials) so this Ash glows
    // on its own.
    let mat: THREE.MeshStandardMaterial | null = null;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        const idx = mesh.material.findIndex((mm) => (mm as THREE.Material)?.name === 'CigaretteAsh');
        if (idx >= 0) {
          const arr = mesh.material.slice();
          const cl = (arr[idx] as THREE.MeshStandardMaterial).clone();
          arr[idx] = cl; mesh.material = arr; mat = cl;
        }
      } else if ((mesh.material as THREE.Material)?.name === 'CigaretteAsh') {
        const cl = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = cl; mat = cl;
      }
    });
    matRef.current = mat;

    let tip: THREE.Object3D | null = null;
    group.traverse((o) => { if (o.name === 'CigaretteTip') tip = o; });
    tipRef.current = tip;
    if (!tip) return;   // not Ash → no smoke

    const tex = smokeTexture();
    const smokeGrp = new THREE.Group(); smokeGrp.name = '__cigSmoke';
    const puffs: Puff[] = [];
    for (let i = 0; i < N; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0x8f8f8f, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(m); s.scale.setScalar(0.001); s.visible = false;
      smokeGrp.add(s); puffs.push({ s, age: LIFE + 1, life: LIFE, vx: 0, vz: 0 });
    }
    group.add(smokeGrp); puffsRef.current = puffs;
    return () => {
      group.remove(smokeGrp);
      puffs.forEach((p) => (p.s.material as THREE.SpriteMaterial).dispose());
      puffsRef.current = [];
    };
  }, [group]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    // Drags fire at random 6–10s intervals; each glows over DRAG_LEN (smooth grey→orange→grey).
    if (nextDrag.current < 0) nextDrag.current = t + DRAG_MIN + Math.random() * (DRAG_MAX - DRAG_MIN);
    if (dragStart.current < 0 && t >= nextDrag.current) dragStart.current = t;
    let glow = 0;
    if (dragStart.current >= 0) {
      const e = t - dragStart.current;
      if (e < DRAG_LEN) glow = Math.sin((e / DRAG_LEN) * Math.PI);   // 0→1→0
      else { dragStart.current = -1; nextDrag.current = t + DRAG_MIN + Math.random() * (DRAG_MAX - DRAG_MIN); }
    }

    const mat = matRef.current;
    if (mat) {
      mat.color.setRGB(0.62 + glow * 0.38, 0.60 - glow * 0.52, 0.58 - glow * 0.55);  // grey → redder ember (less green/yellow)
      mat.emissive.setRGB(glow * 1.0, glow * 0.08, glow * 0.02);
      mat.emissiveIntensity = 0.15 + glow * 2.6;
    }

    const tip = tipRef.current; const puffs = puffsRef.current;
    if (!tip || !puffs.length) return;
    tip.getWorldPosition(scratch); group.worldToLocal(scratch);   // tip position in group-local space
    spawnAcc.current += dt;
    const interval = glow > 0 ? SPAWN * 0.4 : SPAWN;              // puff harder during a drag
    if (spawnAcc.current >= interval) {
      spawnAcc.current = 0;
      const p = puffs.find((q) => q.age >= q.life);
      if (p) {
        p.age = 0; p.life = LIFE * (0.8 + Math.random() * 0.4);
        p.vx = (Math.random() - 0.5) * 0.018; p.vz = (Math.random() - 0.5) * 0.018;
        p.s.position.set(scratch.x + (Math.random() - 0.5) * 0.006, scratch.y, scratch.z + (Math.random() - 0.5) * 0.006);
        p.s.visible = true;
      }
    }
    for (const p of puffs) {
      if (p.age >= p.life) { if (p.s.visible) p.s.visible = false; continue; }
      p.age += dt; const f = p.age / p.life;
      p.s.position.y += RISE * dt; p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(0.0105 + f * 0.045);                    // 50% larger; grows as it rises
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, f * 8) * (1 - f) * 0.5;  // fade in then out
    }
  });

  return null;
}
