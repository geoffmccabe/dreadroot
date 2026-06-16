// SiegeCharacter — the local player's chosen Siege Worlds character. Each character glb is
// self-contained (skin + skeleton + all 15 animations) on ONE shared 48-bone upright rig.
//
// The animated rig lives in <CharacterRig key={selected}>, so switching character forces a FULL
// remount — a fresh AnimationMixer bound cleanly to the fresh clone. (drei's useAnimations creates
// its mixer once and does NOT cleanly rebind when the model is swapped in place; that left
// switched-to characters frozen. The key fixes that.) The parent owns the stable dropdown +
// Ctrl/Cmd+V toggle so those survive switches.
//
// Orientation/scale come from the shared rig: we ALWAYS play an animation, which poses the mesh
// upright (the raw per-character bind geometry is inconsistent and only correct once posed), and
// normalize Head→feet to a standard height with feet on the ground.
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

// ── Rig: one character's model + animations. Remounted (fresh mixer) on every switch. ──
function CharacterRig({ selected }: { selected: string }) {
  const camera = useThree((s) => s.camera);
  const { scene, animations } = useGLTF(`/siege/characters/${selected}.glb`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);   // mixer root + world placement (scale lives here)
  const { actions, names, mixer } = useAnimations(animations, group);
  const hips = useMemo(() => cloned.getObjectByName('Hips') as THREE.Bone | null, [cloned]);

  // Skinned-mesh rebind diagnostic: is the mesh's skeleton bound to the SAME bone objects in the
  // rendered hierarchy (SkeletonUtils rebind worked)?
  const skinDbg = useMemo(() => {
    let sm: THREE.SkinnedMesh | null = null;
    cloned.traverse((o) => { if (!sm && (o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh; });
    if (!sm) return 'NO SKINNED MESH';
    const sk = (sm as THREE.SkinnedMesh).skeleton;
    const b0 = sk?.bones?.[0];
    const inTree = b0 ? cloned.getObjectByName(b0.name) === b0 : false;
    return `skin bones:${sk?.bones?.length ?? 0} rebindOK:${inTree}`;
  }, [cloned]);
  const hipsRangeX = useRef({ min: 9, max: -9 });

  // Normalize from the shared rig: scale Head→feet to TARGET_H, lift feet to the group origin.
  const norm = useMemo(() => {
    cloned.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const headY = cloned.getObjectByName('Head')?.getWorldPosition(v.clone()).y ?? 1.565;
    const tl = cloned.getObjectByName('Toes_L')?.getWorldPosition(v.clone()).y;
    const tr = cloned.getObjectByName('Toes_R')?.getWorldPosition(v.clone()).y;
    const footY = Math.min(tl ?? 0, tr ?? 0);
    const scale = TARGET_H / Math.max(headY - footY, 0.5);
    return { scale, footLift: -footY * scale };
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
    hipsRangeX.current = { min: 9, max: -9 };
  };

  // Play idle the instant clips bind — poses the mesh upright.
  useEffect(() => {
    if (!names.length) return;
    const idle = names.find((n) => n.toLowerCase().includes('idle')) || names[0];
    if (!desired.current) desired.current = idle;
    play(desired.current);
  }, [actions, names]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel (buttons) — created on mount, torn down on unmount (so it rebuilds cleanly per switch).
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const panel = document.createElement('div');
    panel.id = 'sw-anim-panel';
    panel.style.cssText = 'position:fixed;left:12px;top:90px;z-index:9999;display:none;flex-direction:column;gap:4px;background:rgba(0,0,0,.65);padding:8px;border-radius:6px;max-height:80vh;overflow:auto';
    document.body.appendChild(panel);
    panelRef.current = panel;
    return () => { panel.remove(); panelRef.current = null; };
  }, []);

  // (Re)build buttons when clips arrive.
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

  // Live debug overlay (top-right).
  const dbgRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;right:12px;top:90px;z-index:9999;font:11px monospace;color:#7f8;background:rgba(0,0,0,.7);padding:6px 8px;border-radius:5px;white-space:pre;max-width:46vw';
    document.body.appendChild(d); dbgRef.current = d;
    return () => { d.remove(); dbgRef.current = null; };
  }, []);
  const dbgTick = useRef(0);

  const lastPanelOn = useRef<boolean | null>(null);
  useFrame(() => {
    const g = group.current; if (!g) return;
    const on = isInspectView();
    if (hips) {
      const x = hips.quaternion.x;
      const r = hipsRangeX.current;
      if (x < r.min) r.min = x; if (x > r.max) r.max = x;
    }
    if (dbgRef.current && (dbgTick.current++ % 6 === 0)) {
      const a = cur.current ? actionsRef.current[cur.current] : null;
      const r = hipsRangeX.current;
      dbgRef.current.textContent =
        `char:${selected}\nclips:${names.length} inspect:${on}\ncur:${cleanAnim(cur.current) || '—'}\n` +
        `action? ${!!a} running:${a ? a.isRunning() : '—'} w:${a ? a.getEffectiveWeight().toFixed(2) : '—'}\n` +
        `mixer.time:${mixer.time.toFixed(2)}\n` +
        `hipsQ.x RANGE:${r.min.toFixed(4)}..${r.max.toFixed(4)} (moving=${(r.max - r.min) > 0.001})\n` +
        `${skinDbg}\n` +
        `groupScale:${g.scale.x.toFixed(2)} vis:${g.visible}`;
    }
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
