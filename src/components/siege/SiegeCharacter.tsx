// SiegeCharacter — the local player's chosen Siege Worlds character. Each character glb is
// self-contained (skin + skeleton + all 15 animations) on ONE shared 48-bone upright rig.
//
// IMPORTANT — why earlier versions appeared "on their backs and not animating": the per-character
// MESH geometry is authored at wildly inconsistent scales/orientations (knight ~2cm, ragnar ~2m,
// some lying along Z), but every mesh is skinned to the SAME upright animated rig. At its frozen
// bind pose the mesh shows that raw authored orientation; the moment an animation plays, the mesh
// follows the upright bones and stands correctly. So the fix is simply to ALWAYS play an animation
// (like the working MonsterEnemy does) — orientation/scale then come from the shared rig, not the
// bind geometry. We measure the rig's Head→feet height for one consistent normalize.
//
// Hidden in first person; INSPECT view (Ctrl/Cmd+V) freezes + shows it 3m ahead so you can walk
// around it, with a left-side button panel to play each clip. A top dropdown switches character.
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

const TARGET_H = 1.85;   // normalize the rig (Head→feet) to ~human height

// "Root|3D_Idle_Movement 1|Animation Base Layer" → "Idle"
const cleanAnim = (n: string) => (n.split('|')[1] || n).replace(/3D_/g, '').replace(/_Movement/gi, '').replace(/\s*\d+$/, '').replace(/_/g, ' ').trim() || n;

export function SiegeCharacter() {
  useSiegeCharacter();
  const selected = getSelectedCharacter();
  const camera = useThree((s) => s.camera);

  const { scene, animations } = useGLTF(`/siege/characters/${selected}.glb`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);   // mixer root + world placement (scale lives here)
  const { actions, names } = useAnimations(animations, group);

  // One normalize from the shared rig: scale Head→feet to TARGET_H, lift feet to the group origin.
  const norm = useMemo(() => {
    cloned.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const headY = cloned.getObjectByName('Head')?.getWorldPosition(v.clone()).y ?? 1.565;
    const tl = cloned.getObjectByName('Toes_L')?.getWorldPosition(v.clone()).y;
    const tr = cloned.getObjectByName('Toes_R')?.getWorldPosition(v.clone()).y;
    const footY = Math.min(tl ?? 0, tr ?? 0);
    const scale = TARGET_H / Math.max(headY - footY, 0.5);
    return { scale, footLift: -footY * scale };   // group.y = terrain + footLift → feet on ground
  }, [cloned]);

  const desired = useRef('');
  const cur = useRef('');
  const frozen = useRef<{ set: boolean; x: number; y: number; z: number; yaw: number }>({ set: false, x: 0, y: 0, z: 0, yaw: 0 });

  const actionsRef = useRef(actions); actionsRef.current = actions;
  const play = (name: string) => {
    const a = name ? actionsRef.current[name] : null;
    if (!a || cur.current === name) return;
    Object.values(actionsRef.current).forEach((x) => { if (x && x !== a) x.fadeOut(0.2); });
    a.reset().fadeIn(0.2).play();
    cur.current = name;
  };

  // Play idle the instant clips bind (NOT gated on inspect) — this is what poses the mesh upright.
  useEffect(() => {
    if (!names.length) return;
    const idle = names.find((n) => n.toLowerCase().includes('idle')) || names[0];
    if (!desired.current) desired.current = idle;
    play(desired.current);
  }, [actions, names]); // eslint-disable-line react-hooks/exhaustive-deps

  // DOM dropdown + panel container + keydown — created ONCE; visibility driven from the frame loop
  // (previous panel bug: it was recreated when clips loaded async, resetting it to hidden).
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    panel.style.cssText = 'position:fixed;left:12px;top:90px;z-index:9999;display:none;flex-direction:column;gap:4px;background:rgba(0,0,0,.65);padding:8px;border-radius:6px;max-height:80vh;overflow:auto';
    document.body.appendChild(panel);
    panelRef.current = panel;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        setInspectView(!isInspectView());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); sel.remove(); panel.remove(); panelRef.current = null; };
  }, []);

  // (Re)build the animation buttons whenever the clip list changes.
  useEffect(() => {
    const panel = panelRef.current; if (!panel) return;
    panel.replaceChildren();
    const title = document.createElement('div');
    title.textContent = `DEBUG: ${selected} | clips:${names.length} | scale:${norm.scale.toFixed(2)}`;
    title.style.cssText = 'color:#9cf;font:11px monospace;margin-bottom:2px';
    panel.appendChild(title);
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
  }, [names]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const s = document.getElementById('sw-char-picker') as HTMLSelectElement | null; if (s) s.value = selected; }, [selected]);

  const lastPanelOn = useRef<boolean | null>(null);
  useFrame(() => {
    const g = group.current; if (!g) return;
    const on = isInspectView();
    if (lastPanelOn.current !== on && panelRef.current) {
      panelRef.current.style.display = on ? 'flex' : 'none';
      lastPanelOn.current = on;
    }
    if (on) {
      if (!frozen.current.set) {
        const d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
        const x = camera.position.x + d.x * 3, z = camera.position.z + d.z * 3;
        const groundY = sampleHeight(x, z) ?? camera.position.y - 1.6;
        frozen.current = { set: true, x, y: groundY + norm.footLift, z, yaw: Math.atan2(-d.x, -d.z) };
      }
      const f = frozen.current;
      g.position.set(f.x, f.y, f.z);
      g.rotation.set(0, f.yaw, 0);
      g.visible = true;
      play(desired.current);
    } else {
      frozen.current.set = false;
      g.visible = false;
    }
  });

  return (
    <group ref={group} scale={norm.scale} visible={false}>
      <primitive object={cloned} />
    </group>
  );
}
