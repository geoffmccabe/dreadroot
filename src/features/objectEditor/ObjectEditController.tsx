// Phase-0 input driver. This is ONE driver for the input-agnostic core — it only
// translates key/mouse events into store commands (select / spawn / transform /
// duplicate / delete / undo). A future VR driver does the same against the same core.
//
// Locked to admins/superadmins: backtick (`) toggles edit mode. While edit mode is
// ON, the editor keys/clicks are captured (capture-phase) so they pre-empt weapon
// fire / block placement; WASD still walks. Off by default — normal play untouched.
//
// Phase-0 controls (edit mode ON):
//   `        toggle edit mode            click   select object under crosshair
//   P        spawn a test box ahead      Esc     deselect
//   ←→ move X · ↑↓ move Z · Shift+↑↓ (or PgUp/Dn / Fn+↑↓ on Mac) move Y   (0.5 m)
//   [ ]      rotate (yaw)  - =  scale     Shift+D duplicate  Del  delete
//   Cmd/Ctrl+Z undo        +Shift redo
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { IDENTITY_QUAT, type TRS } from './types';
import {
  getCanEdit, getEditMode, toggleEditMode, setSelected, current,
  addObject, transformSelected, duplicateSelected, deleteSelected, undo, redo,
  selectBaked, clearBaked,
} from './store';
import { placeKey, transformOverrides } from './bakedOverrides';

const MOVE = 0.5;
const YAW = Math.PI / 12;
const clampScale = (s: number) => Math.min(50, Math.max(0.05, s));

export function ObjectEditController() {
  const { camera, scene } = useThree();
  const ro = useMemo(() => new THREE.Vector3(), []);
  const rd = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const dq = useMemo(() => new THREE.Quaternion(), []);
  const cq = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    ray.near = 0.8; // skip first-person arms/weapon right in front of the camera
    // Baked map instance (Enchanted Forest cliffs/trees): derive its stable key + model-local
    // transform so it can be moved in place, and select it as a temporary editable object.
    const selectBakedHit = (im: THREE.InstancedMesh, instanceId: number): boolean => {
      const placements = im.userData.placements as number[][] | undefined;
      const baseArr = placements?.[instanceId]; if (!baseArr) return false;
      const fbx = im.userData.fbx as string;
      const key = placeKey(fbx, baseArr[12], baseArr[13], baseArr[14]);
      const curArr = transformOverrides.get(key)?.matrix ?? baseArr;
      const curP = new THREE.Matrix4().fromArray(curArr);
      const cur = new THREE.Matrix4(); im.getMatrixAt(instanceId, cur);
      const local = new THREE.Matrix4().copy(curP).invert().multiply(cur);
      const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
      curP.decompose(P, Q, S);
      selectBaked(
        { key, fbx, localArr: local.toArray(), mesh: im, instanceId },
        { pos: [P.x, P.y, P.z], quat: [Q.x, Q.y, Q.z, Q.w], scale: [S.x, S.y, S.z] },
      );
      return true;
    };

    const selectAtCrosshair = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      for (const h of hits) {
        // 1) an editor-placed object (world_objects)
        let o: THREE.Object3D | null = h.object;
        while (o) { if (o.userData?.worldObjectId) { clearBaked(); setSelected(o.userData.worldObjectId as string); return; } o = o.parent; }
        // 2) a baked map instance
        const im = h.object as THREE.InstancedMesh;
        if (im.isInstancedMesh && im.userData?.placements && h.instanceId != null && selectBakedHit(im, h.instanceId)) return;
      }
      clearBaked(); setSelected(null);
    };

    const spawnAhead = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      const p = hits.length ? hits[0].point.clone() : ro.clone().addScaledVector(rd, 5);
      p.y += 0.5;
      addObject({ id: crypto.randomUUID(), modelUrl: 'builtin:box', pos: [p.x, p.y, p.z], quat: [...IDENTITY_QUAT], scale: [1, 1, 1] });
    };

    const move = (dx: number, dy: number, dz: number) => {
      const o = current(); if (!o) return;
      const next: TRS = { pos: [o.pos[0] + dx, o.pos[1] + dy, o.pos[2] + dz], quat: o.quat, scale: o.scale };
      transformSelected(next);
    };
    const yaw = (d: number) => {
      const o = current(); if (!o) return;
      cq.set(o.quat[0], o.quat[1], o.quat[2], o.quat[3]);
      dq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d);
      cq.premultiply(dq);
      transformSelected({ pos: o.pos, quat: [cq.x, cq.y, cq.z, cq.w], scale: o.scale });
    };
    const scaleBy = (f: number) => {
      const o = current(); if (!o) return;
      transformSelected({ pos: o.pos, quat: o.quat, scale: [clampScale(o.scale[0] * f), clampScale(o.scale[1] * f), clampScale(o.scale[2] * f)] });
    };

    const onMouse = (e: MouseEvent) => {
      if (!getEditMode() || e.button !== 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      selectAtCrosshair();
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      // Toggle works any time (superadmin only); everything else needs edit mode. SHIFT+` so it no
      // longer rides on the plain-` God Mode toggle (which was auto-opening the Arrange menu).
      if (e.code === 'Backquote' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (getCanEdit()) { toggleEditMode(); e.preventDefault(); }
        return;
      }
      if (!getEditMode()) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod) return; // leave other browser/game meta combos alone

      let handled = true;
      switch (e.code) {
        case 'ArrowLeft':  move(-MOVE, 0, 0); break;
        case 'ArrowRight': move(MOVE, 0, 0); break;
        // Shift+↑↓ raises/lowers (Mac-friendly: no Page Up/Down key needed); plain ↑↓ = forward/back.
        case 'ArrowUp':    e.shiftKey ? move(0, MOVE, 0) : move(0, 0, -MOVE); break;
        case 'ArrowDown':  e.shiftKey ? move(0, -MOVE, 0) : move(0, 0, MOVE); break;
        case 'PageUp':     move(0, MOVE, 0); break;
        case 'PageDown':   move(0, -MOVE, 0); break;
        case 'BracketLeft':  yaw(-YAW); break;
        case 'BracketRight': yaw(YAW); break;
        case 'Minus':  scaleBy(0.9); break;
        case 'Equal':  scaleBy(1.1); break;
        case 'KeyP':   spawnAhead(); break;
        case 'KeyD':   if (e.shiftKey) duplicateSelected([1, 0, 0]); else handled = false; break;
        case 'Delete': case 'Backspace': deleteSelected(); break;
        case 'Escape': setSelected(null); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };

    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onMouse, true); window.removeEventListener('keydown', onKey, true); };
  }, [camera, scene, ray, ro, rd, dq, cq]);

  return null;
}
