// SiegeCharacter — renders the local player's chosen Siege Worlds character (a skin on the
// shared rig) and animates it from the shared clip set (_animations.glb). Hidden in first person
// (you'd block your own view); a 2nd-person INSPECT view (Ctrl/Cmd+V) freezes the character in
// front of you, shows it, and lets you walk/fly around to see it — J/K cycle its animations so
// you can preview what it can do. A small dropdown picks/switches the character.
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

// Preload the shared animations once.
useGLTF.preload('/siege/characters/_animations.glb');

function readout(text: string) {
  let el = document.getElementById('sw-char-readout');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sw-char-readout';
    el.style.cssText = 'position:fixed;left:50%;top:46px;transform:translateX(-50%);z-index:9999;font:12px monospace;color:#cfe;background:rgba(0,0,0,.6);padding:3px 8px;border-radius:4px;pointer-events:none;white-space:nowrap';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

export function SiegeCharacter() {
  useSiegeCharacter();                       // re-render on character / inspect change
  const selected = getSelectedCharacter();
  const inspect = isInspectView();
  const camera = useThree((s) => s.camera);

  const skin = useGLTF(`/siege/characters/${selected}.glb`);
  const anims = useGLTF('/siege/characters/_animations.glb');
  const cloned = useMemo(() => SkeletonUtils.clone(skin.scene) as THREE.Group, [skin.scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(anims.animations, group);

  const animIdx = useRef(0);
  const cur = useRef('');
  const frozen = useRef<{ set: boolean; x: number; y: number; z: number; yaw: number }>({ set: false, x: 0, y: 0, z: 0, yaw: 0 });

  const idleIdx = useMemo(() => Math.max(0, names.findIndex((n) => n.toLowerCase().includes('idle'))), [names]);
  useEffect(() => { animIdx.current = idleIdx; }, [idleIdx, selected]);

  const play = (name: string) => {
    const a = name ? actions[name] : null;
    if (!a || cur.current === name) return;
    Object.values(actions).forEach((x) => { if (x && x !== a) x.fadeOut(0.2); });
    a.reset().fadeIn(0.2).play();
    cur.current = name;
  };

  // Dropdown picker + key handlers (Ctrl/Cmd+V = inspect; J/K = cycle anim in inspect).
  useEffect(() => {
    const sel = document.createElement('select');
    sel.id = 'sw-char-picker';
    sel.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;font:13px sans-serif;background:rgba(0,0,0,.7);color:#fff;border:1px solid #456;border-radius:5px;padding:4px 8px';
    for (const c of SIEGE_CHARACTERS) {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    }
    sel.value = getSelectedCharacter();
    sel.onchange = () => setSelectedCharacter(sel.value);
    document.body.appendChild(sel);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation(); setInspectView(!isInspectView());
      } else if (isInspectView() && (e.code === 'KeyJ' || e.code === 'KeyK') && names.length) {
        e.preventDefault();
        animIdx.current = (animIdx.current + (e.code === 'KeyK' ? 1 : names.length - 1)) % names.length;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      sel.remove();
      document.getElementById('sw-char-readout')?.remove();
    };
  }, [names]);

  // keep the dropdown in sync if changed elsewhere
  useEffect(() => { const s = document.getElementById('sw-char-picker') as HTMLSelectElement | null; if (s) s.value = selected; }, [selected]);

  useFrame(() => {
    const g = group.current; if (!g) return;
    if (inspect) {
      if (!frozen.current.set) {
        const d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
        const x = camera.position.x + d.x * 3, z = camera.position.z + d.z * 3;
        const gy = sampleHeight(x, z);
        frozen.current = { set: true, x, y: gy ?? camera.position.y - 1.6, z, yaw: Math.atan2(-d.x, -d.z) };
      }
      const f = frozen.current;
      g.position.set(f.x, f.y, f.z);
      g.rotation.set(0, f.yaw, 0);   // face back toward where the player was standing
      g.visible = true;
      play(names[animIdx.current] || names[idleIdx] || '');
      readout(`${selected}  —  ${(names[animIdx.current] || '').replace(/Root\||\|.*/g, '').trim() || 'idle'}   (Ctrl/Cmd+V exit · J/K anim)`);
    } else {
      frozen.current.set = false;
      g.visible = false;
    }
  });

  return <group ref={group} visible={false}><primitive object={cloned} /></group>;
}
