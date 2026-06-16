// SiegeCharacter — the local player's chosen Siege Worlds character.
//
// Rendering reuses the PROVEN recipe from CharacterLineup: the raw glb scene (NOT a
// SkeletonUtils clone — cloning mangles these rigs and stretches the mesh), with a precomputed
// per-character [scale, feetY, rot] so each one stands upright at the right size with feet on the
// ground. On top of that we add drei animation (useAnimations on the outer group) + a button panel
// to play each clip. The rig is keyed by character so switching fully remounts (fresh mixer).
//
// Hidden in first person; INSPECT view (Ctrl/Cmd+V) freezes + shows it 3m ahead so you can walk
// around it. A top dropdown switches character.
import { useEffect, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import {
  SIEGE_CHARACTERS, getSelectedCharacter, setSelectedCharacter,
  isInspectView, setInspectView, useSiegeCharacter,
} from '@/config/siegeCharacter';

// Per-character [scale, feetY, rot] — copied from CharacterLineup (precomputed offline; known-good).
// rot 0 = Z-up source (stand up via -90X), rot 1 = Y-up source (already upright). Characters not
// listed fall back to [1, 0, 1].
const LINEUP: Record<string, [number, number, number]> = {
  angus: [1.00042, -0.003, 1], ashandthorn: [1.00976, -0.0055, 1], bonnie: [0.9583, 0.0, 1],
  butch: [0.96989, -0.0029, 1], chalk: [0.97782, -0.0036, 1], crazyhorse: [0.9824, -0.0029, 1],
  dago: [0.01222, -0.0771, 0], doge: [1.00078, -0.0, 1], dulla: [0.92484, 0.0001, 1],
  flamma: [1.00319, 0.0007, 1], janx: [1.05926, -0.004, 1], jeanette: [0.00983, -0.0231, 0],
  koraka: [0.01351, -0.0136, 0], ladyhao: [0.99766, 0.0056, 1], lozen: [0.99749, -0.003, 1],
  mochizuki: [1.04084, -0.0035, 1], musashi: [0.94117, -0.0, 1], nakano: [0.00937, -0.0515, 0],
  pigtailgirl: [0.95994, -0.0038, 1], ragnar: [0.9278, -0.0, 1], rajax: [0.73555, -0.3835, 1],
  rakshaz: [0.73555, -0.3835, 1], shiyang: [0.00897, -0.0363, 0], tlahucole: [0.91877, -0.0027, 1],
  toshiro: [0.00997, -0.005, 0], yaaantesawa: [0.95493, 0.0032, 1], zap: [0.98171, -0.0031, 1],
};
const ROT: [number, number, number][] = [[-Math.PI / 2, Math.PI, 0], [0, Math.PI, 0]];

// "Root|3D_Idle_Movement 1|Animation Base Layer" → "Idle"
const cleanAnim = (n: string) => (n.split('|')[1] || n).replace(/3D_/g, '').replace(/_Movement/gi, '').replace(/\s*\d+$/, '').replace(/_/g, ' ').trim() || n;

// ── Parent: stable dropdown + inspect toggle; remounts the rig per character via key ──
export function SiegeCharacter() {
  useSiegeCharacter();
  const selected = getSelectedCharacter();

  useEffect(() => {
    const sel = document.createElement('select');
    sel.id = 'sw-char-picker';
    sel.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;font:13px sans-serif;background:rgba(0,0,0,.7);color:#fff;border:1px solid #456;border-radius:5px;padding:4px 8px';
    for (const c of SIEGE_CHARACTERS) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
    sel.value = getSelectedCharacter();
    sel.onchange = () => setSelectedCharacter(sel.value);
    document.body.appendChild(sel);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        setInspectView(!isInspectView());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); sel.remove(); };
  }, []);

  useEffect(() => { const s = document.getElementById('sw-char-picker') as HTMLSelectElement | null; if (s) s.value = selected; }, [selected]);

  return <CharacterRig key={selected} selected={selected} />;
}

// ── Rig: one character (raw scene, lineup transform) + animations. Remounted on each switch. ──
function CharacterRig({ selected }: { selected: string }) {
  const camera = useThree((s) => s.camera);
  const { scene, animations } = useGLTF(`/siege/characters/${selected}.glb`);
  const group = useRef<THREE.Group>(null);   // mixer root + world placement (scale lives here)
  const { actions, names } = useAnimations(animations, group);
  const [scale, feetY, rot] = LINEUP[selected] ?? [1, 0, 1];

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

  useEffect(() => {
    if (!names.length) return;
    const idle = names.find((n) => n.toLowerCase().includes('idle')) || names[0];
    if (!desired.current) desired.current = idle;
    play(desired.current);
  }, [actions, names]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animation button panel — created/destroyed with the rig (clean rebuild per switch).
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const panel = document.createElement('div');
    panel.id = 'sw-anim-panel';
    panel.style.cssText = 'position:fixed;left:12px;top:90px;z-index:9999;display:none;flex-direction:column;gap:4px;background:rgba(0,0,0,.65);padding:8px;border-radius:6px;max-height:80vh;overflow:auto';
    document.body.appendChild(panel);
    panelRef.current = panel;
    return () => { panel.remove(); panelRef.current = null; };
  }, []);

  useEffect(() => {
    const panel = panelRef.current; if (!panel) return;
    panel.replaceChildren();
    const title = document.createElement('div');
    title.textContent = `${selected} — animations`;
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
        frozen.current = { set: true, x, y: groundY - feetY, z, yaw: Math.atan2(-d.x, -d.z) };
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
    <group ref={group} scale={scale} visible={false}>
      <group rotation={ROT[rot]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
