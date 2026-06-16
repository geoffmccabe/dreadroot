// SiegeCharacter — the local player's chosen Siege Worlds character. Each character glb is
// self-contained (skin + skeleton + all 15 animations), cloned + animated the same way the
// monsters are (so animation is guaranteed to bind). Auto-normalized to a standard height with
// feet on the ground (the source skins have inconsistent scales). Hidden in first person; the
// INSPECT view (Ctrl/Cmd+V) freezes + shows it so you can walk/fly around it, and a button panel
// lets you play each animation. A dropdown picks/switches the character.
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import {
  SIEGE_CHARACTERS, getSelectedCharacter, setSelectedCharacter,
  isInspectView, setInspectView, useSiegeCharacter,
} from '@/config/siegeCharacter';

const TARGET_H = 1.85;   // normalize every character to ~human height (max bbox dimension)

// "Root|3D_Idle_Movement 1|Animation Base Layer" → "Idle"
const cleanAnim = (n: string) => (n.split('|')[1] || n).replace(/3D_/g, '').replace(/_Movement/gi, '').replace(/\s*\d+$/, '').replace(/_/g, ' ').trim() || n;

export function SiegeCharacter() {
  useSiegeCharacter();
  const selected = getSelectedCharacter();
  const camera = useThree((s) => s.camera);

  const { scene, animations } = useGLTF(`/siege/characters/${selected}.glb`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);     // outer: world position + facing
  const inner = useRef<THREE.Group>(null);     // normalize: scale + feet-to-origin
  const { actions, names } = useAnimations(animations, group);

  // size normalization from the clone's bounding box
  const norm = useMemo(() => {
    cloned.updateMatrixWorld(true);   // ensure node scales are baked into the bbox
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const s = TARGET_H / Math.max(size.x, size.y, size.z, 0.001);
    return { scale: s, feetY: -box.min.y * s };   // lift so the lowest point sits at the group origin
  }, [cloned]);

  const desired = useRef('');
  const cur = useRef('');
  const frozen = useRef<{ set: boolean; x: number; y: number; z: number; yaw: number }>({ set: false, x: 0, y: 0, z: 0, yaw: 0 });
  const idleName = useMemo(() => names.find((n) => n.toLowerCase().includes('idle')) || names[0] || '', [names]);
  useEffect(() => { desired.current = idleName; }, [idleName, selected]);

  // actions kept in a ref so the DOM buttons (built in an effect) can play them
  const actionsRef = useRef(actions); actionsRef.current = actions;
  const play = (name: string) => {
    const a = name ? actionsRef.current[name] : null;
    if (!a || cur.current === name) return;
    Object.values(actionsRef.current).forEach((x) => { if (x && x !== a) x.fadeOut(0.2); });
    a.reset().fadeIn(0.2).play();
    cur.current = name;
  };

  // ── Dropdown (always) + animation button panel (shown in inspect) ──
  useEffect(() => {
    const sel = document.createElement('select');
    sel.id = 'sw-char-picker';
    sel.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;font:13px sans-serif;background:rgba(0,0,0,.7);color:#fff;border:1px solid #456;border-radius:5px;padding:4px 8px';
    for (const c of SIEGE_CHARACTERS) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
    sel.value = getSelectedCharacter();
    sel.onchange = () => setSelectedCharacter(sel.value);
    document.body.appendChild(sel);

    const panel = document.createElement('div');
    panel.id = 'sw-anim-panel';
    panel.style.cssText = 'position:fixed;left:12px;top:90px;z-index:9999;display:none;flex-direction:column;gap:4px;background:rgba(0,0,0,.6);padding:8px;border-radius:6px;max-height:80vh;overflow:auto';
    const title = document.createElement('div'); title.textContent = 'Animations (Ctrl/Cmd+V to exit)';
    title.style.cssText = 'color:#9cf;font:11px monospace;margin-bottom:2px'; panel.appendChild(title);
    for (const n of names) {
      const b = document.createElement('button'); b.textContent = cleanAnim(n);
      b.style.cssText = 'font:12px sans-serif;text-align:left;background:#234;color:#fff;border:1px solid #456;border-radius:4px;padding:4px 10px;cursor:pointer';
      b.onclick = () => {
        desired.current = n; play(n);
        for (const c of panel.querySelectorAll('button')) (c as HTMLElement).style.background = '#234';
        b.style.background = '#2a6';
      };
      panel.appendChild(b);
    }
    document.body.appendChild(panel);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        const on = !isInspectView(); setInspectView(on);
        panel.style.display = on ? 'flex' : 'none';
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); sel.remove(); panel.remove(); };
  }, [names]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const s = document.getElementById('sw-char-picker') as HTMLSelectElement | null; if (s) s.value = selected; }, [selected]);

  useFrame(() => {
    const g = group.current; if (!g) return;
    if (isInspectView()) {
      if (!frozen.current.set) {
        const d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
        const x = camera.position.x + d.x * 3, z = camera.position.z + d.z * 3;
        frozen.current = { set: true, x, y: sampleHeight(x, z) ?? camera.position.y - 1.6, z, yaw: Math.atan2(-d.x, -d.z) };
      }
      const f = frozen.current;
      g.position.set(f.x, f.y, f.z);
      g.rotation.set(0, f.yaw, 0);
      g.visible = true;
      play(desired.current || idleName);
    } else {
      frozen.current.set = false;
      g.visible = false;
    }
  });

  return (
    <group ref={group} visible={false}>
      <group ref={inner} scale={norm.scale} position={[0, norm.feetY, 0]}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}
