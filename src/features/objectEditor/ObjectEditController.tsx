// Input driver for the Arrange tool — ONE driver translating mouse/keys into store commands
// (a future VR driver does the same against the same core). This is a first-person game with a
// pointer-locked mouse (no free desktop cursor), so "grab and drag" is the physgun model: aim the
// crosshair at an object, HOLD the left button, and it rides on its height-plane wherever you look;
// release to drop. The wheel raises/lowers (Shift+wheel rotate · Option+wheel scale); hold Ctrl to
// ride the surface beneath. Right hand never leaves the mouse; left hand only ever on the modifier
// row — WASD/S stay free for walking. Locked to admins/superadmins; Shift+` toggles edit mode.
//
// Controls (edit mode ON):
//   Shift+`   toggle edit mode          hold L-btn  grab & carry on the height plane
//   wheel     raise / lower             Shift+wheel rotate · Option+wheel scale
//   hold Ctrl ride surface below        Shift+click grab a duplicate
//   P spawn box · Del delete · Esc cancel/deselect · Cmd-Z undo (+Shift redo)
import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { IDENTITY_QUAT, type TRS } from './types';
import {
  getCanEdit, getEditMode, toggleEditMode, setSelected, current,
  addObject, transformSelected, duplicateSelected, deleteSelected, undo, redo,
  selectBaked, clearBaked, dragBegin, dragTo, dragCommit, dragCancel, isDragging,
} from './store';
import { placeKey, transformOverrides } from './bakedOverrides';
import { getProfile, snapAxis } from './controlProfiles';
import { SelectionHighlight } from './SelectionHighlight';

const SELECT_MAX = 150;    // biggest individual object you can grab (m) — tall trees qualify; bigger
                           // than this is a merged-region blob (also caught by the `combined` flag)
const MIN_REACH = 1.5;     // closest the carried object can sit to the camera (m)
const MAX_REACH = 150;     // furthest a plane-hit is accepted before falling back to last reach
const SNAP_UP = 60;        // how far above the carry point the surface down-ray starts (m)
const clampScale = (s: number) => Math.min(50, Math.max(0.05, s));

export function ObjectEditController() {
  const { camera, scene } = useThree();
  const ro = useMemo(() => new THREE.Vector3(), []);
  const rd = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const dray = useMemo(() => new THREE.Raycaster(), []);
  const dq = useMemo(() => new THREE.Quaternion(), []);
  const cq = useMemo(() => new THREE.Quaternion(), []);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  // Live grab state (refs so the frame loop reads them without re-subscribing).
  const grab = useRef({ active: false, planeY: 0, reach: 8, offsetX: 0, offsetZ: 0 });
  const ctrlDown = useRef(false);

  useEffect(() => {
    ray.near = 0.8; // skip first-person arms/weapon right in front of the camera

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

    const selectAtCrosshair = (): boolean => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) { if (o.userData?.worldObjectId) { clearBaked(); setSelected(o.userData.worldObjectId as string); return true; } o = o.parent; }
        const im = h.object as THREE.InstancedMesh;
        if (im.isInstancedMesh && im.userData?.placements && h.instanceId != null) {
          // Only individual objects are grabbable: skip merged-region blobs and map-sized / terrain
          // instances (their bounding box would be the whole map — the giant useless highlight).
          if (im.userData.combined) continue;
          const g = im.geometry as THREE.BufferGeometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const mm = new THREE.Matrix4(); im.getMatrixAt(h.instanceId, mm);
          const sz = new THREE.Vector3(); (g.boundingBox as THREE.Box3).clone().applyMatrix4(mm).getSize(sz);
          if (Math.max(sz.x, sz.y, sz.z) > SELECT_MAX) continue;
          if (selectBakedHit(im, h.instanceId)) return true;
        }
      }
      clearBaked(); setSelected(null); return false;
    };

    const spawnAhead = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      const p = hits.length ? hits[0].point.clone() : ro.clone().addScaledVector(rd, 5);
      p.y += 0.5;
      addObject({ id: crypto.randomUUID(), modelUrl: 'builtin:box', pos: [p.x, p.y, p.z], quat: [...IDENTITY_QUAT], scale: [1, 1, 1] });
    };

    // ── grab / release (left button) ──
    const onDown = (e: MouseEvent) => {
      if (!getEditMode() || e.button !== 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!selectAtCrosshair()) return;          // nothing under the crosshair
      if (e.shiftKey) duplicateSelected([0, 0, 0]); // Shift+click ⇒ grab a copy (no-op for baked)
      const o = current(); if (!o) return;
      camera.getWorldPosition(ro); camera.getWorldDirection(rd);
      grab.current.active = true;
      grab.current.planeY = o.pos[1];
      // Grab OFFSET: the gap between where the crosshair meets the object's height-plane and the
      // object's actual pivot. Holding this constant while carrying means a plain click (no mouse
      // move) leaves the object exactly where it was — selecting never nudges it.
      const t0 = (o.pos[1] - ro.y) / rd.y;
      if (isFinite(t0) && t0 > MIN_REACH && t0 < MAX_REACH) {
        grab.current.reach = t0;
        grab.current.offsetX = (ro.x + rd.x * t0) - o.pos[0];
        grab.current.offsetZ = (ro.z + rd.z * t0) - o.pos[2];
      } else {
        grab.current.reach = Math.max(MIN_REACH, ro.distanceTo(new THREE.Vector3(o.pos[0], o.pos[1], o.pos[2])));
        grab.current.offsetX = 0; grab.current.offsetZ = 0;
      }
      dragBegin();
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || !grab.current.active) return;
      grab.current.active = false;
      dragCommit();
    };

    // ── wheel: raise/lower · Shift rotate · Option scale ──
    const onWheel = (e: WheelEvent) => {
      if (!getEditMode()) return;
      const o = current(); if (!o) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const dir = e.deltaY < 0 ? 1 : -1;       // wheel up = raise / +rotation / +scale
      const pf = getProfile();
      const grabbing = grab.current.active;
      if (e.shiftKey) {                          // rotate yaw
        cq.set(o.quat[0], o.quat[1], o.quat[2], o.quat[3]);
        dq.setFromAxisAngle(yAxis, dir * pf.rotateStep); cq.premultiply(dq);
        const next: TRS = { pos: o.pos, quat: [cq.x, cq.y, cq.z, cq.w], scale: o.scale };
        if (grabbing) dragTo(next); else transformSelected(next);
      } else if (e.altKey) {                     // scale (uniform)
        const f = Math.pow(pf.scaleStep, dir);
        const next: TRS = { pos: o.pos, quat: o.quat, scale: [clampScale(o.scale[0] * f), clampScale(o.scale[1] * f), clampScale(o.scale[2] * f)] };
        if (grabbing) dragTo(next); else transformSelected(next);
      } else {                                   // raise / lower
        if (grabbing) grab.current.planeY += dir * pf.heightStep;  // frame loop applies it
        else transformSelected({ pos: [o.pos[0], o.pos[1] + dir * pf.heightStep, o.pos[2]], quat: o.quat, scale: o.scale });
      }
    };

    // ── keys ──
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlDown.current = true;
      if (isTypingTarget(e)) return;
      if (e.code === 'Backquote' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (getCanEdit()) { toggleEditMode(); if (!getEditMode()) { grab.current.active = false; } e.preventDefault(); }
        return;
      }
      if (!getEditMode()) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.code === 'KeyZ') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && e.code === 'KeyX') { e.preventDefault(); e.stopImmediatePropagation(); deleteSelected(); return; }
      if (meta) return;
      let handled = true;
      switch (e.code) {
        case 'KeyP': spawnAhead(); break;
        case 'Delete': case 'Backspace': deleteSelected(); break;
        case 'Escape': if (isDragging()) { dragCancel(); grab.current.active = false; } else setSelected(null); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control') ctrlDown.current = false; };

    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [camera, scene, ray, ro, rd, dray, down, dq, cq, yAxis]);

  // ── carry loop: while grabbing, slide the object along its height plane under the aim ──
  useFrame(() => {
    if (!grab.current.active || !getEditMode()) return;
    const o = current(); if (!o) { grab.current.active = false; return; }
    camera.getWorldPosition(ro); camera.getWorldDirection(rd);
    // Where the aim ray meets the height plane (y = planeY). When that's invalid (looking up /
    // near-flat), fall back to the last good reach so the object never shoots to infinity.
    let reach = grab.current.reach;
    const t = (grab.current.planeY - ro.y) / rd.y;
    if (isFinite(t) && t > MIN_REACH && t < MAX_REACH) { reach = t; grab.current.reach = t; }
    let x = ro.x + rd.x * reach - grab.current.offsetX;   // keep the grab offset → no jump on click
    let z = ro.z + rd.z * reach - grab.current.offsetZ;
    let y = grab.current.planeY;
    x = snapAxis(x); z = snapAxis(z);               // profile grid snap (no-op when off)
    if (ctrlDown.current) {                          // ride the surface directly beneath the carry point
      dray.set(new THREE.Vector3(x, grab.current.planeY + SNAP_UP, z), down);
      const hits = dray.intersectObjects(scene.children, true);
      const selId = o.id; const selMesh = o.baked?.mesh;
      for (const h of hits) {
        const m = h.object as THREE.Mesh; if (!m.isMesh) continue;
        if (m === selMesh) continue;                 // don't land the baked object on itself
        let p: THREE.Object3D | null = m; let self = false;
        while (p) { if (p.userData?.worldObjectId === selId) { self = true; break; } p = p.parent; }
        if (self) continue;
        y = h.point.y; break;
      }
    }
    dragTo({ pos: [x, y, z], quat: o.quat, scale: o.scale });
  });

  return <SelectionHighlight />;
}
