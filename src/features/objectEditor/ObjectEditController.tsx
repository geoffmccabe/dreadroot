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
//   ^wa add water · F flood selected water to the shoreline (press again after plugging a leak)
import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { IDENTITY_QUAT, type TRS } from './types';
import {
  getCanEdit, getEditMode, toggleEditMode, setSelected, current,
  addObject, transformSelected, duplicateSelected, deleteSelected, undo, redo,
  selectBaked, clearBaked, selectBuilder, clearBuilder, dragBegin, dragTo, dragCommit, dragCancel, isDragging,
  setObjectFlood,
} from './store';
import { getBuilder } from '@/components/siege/builder/builderObjectsState';
import { placeKey, transformOverrides, saveWorldToDb } from './bakedOverrides';
import { getProfile, snapAxis } from './controlProfiles';
import { SelectionHighlight } from './SelectionHighlight';
import { beginFlood, stepFlood, finishFlood, type FloodJob } from './floodFill';
import { meshGroundHeight } from '@/components/siege/meshColliderSystem';
import { sampleHeight } from '@/components/siege/terrainHeight';

const SELECT_MAX = 150;    // biggest individual object you can grab (m) — tall trees qualify; bigger
                           // than this is a merged-region blob (also caught by the `combined` flag)
const MIN_REACH = 1.5;     // closest the carried object can sit to the camera (m)
const MAX_REACH = 150;     // furthest a plane-hit is accepted before falling back to last reach
const SNAP_UP = 60;        // how far above the carry point the surface down-ray starts (m)
const FLOOD_CEIL = 3;      // probe the solid surface from this far ABOVE the waterline: shore/rock/
                           // trunk within 3 m of the surface = a wall; high canopy overhead is ignored
const FLOOD_PER_FRAME = 1500;  // cells probed per frame (matches MeshHeightmapBaker's proven budget)
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
  const grab = useRef({ active: false, planeY: 0, reach: 8, offsetX: 0, offsetZ: 0, startX: 0, startZ: 0, moved: false, hdx: 0, hdz: 1 });
  const ctrlDown = useRef(false);
  const axisHeld = useRef<'x' | 'y' | 'z' | null>(null);   // per-axis stretch: hold X/Y/Z + wheel
  const floodJob = useRef<FloodJob | null>(null);          // in-progress shore-seeking water flood

  useEffect(() => {
    ray.near = 0.8; // skip first-person arms/weapon right in front of the camera
    // Typed spawn codes (e.g. ^wa = water). Pressing ^ ARMS command mode: the following keys are
    // captured as the code (and swallowed so they don't walk you) until it matches or hits a dead end.
    // NB: the trigger is '^' (not '*') because the weapon-tuning lineup steals every '*' keydown
    // (stopImmediatePropagation) while it's open, so '*' never reached here.
    let cmdArmed = false;
    let cmdBuf = '';

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
        while (o) {
          if (o.userData?.worldObjectId) { clearBaked(); clearBuilder(); setSelected(o.userData.worldObjectId as string); return true; }
          if (o.userData?.builderId) {   // a builder-placed object — grab it the same grab-and-carry way
            const bo = getBuilder().objects.find((x) => x.id === o!.userData.builderId);
            if (bo) {
              const hy = bo.rotY / 2;
              clearBaked(); setSelected(null);
              selectBuilder(bo.id, { pos: [...bo.pos], quat: [0, Math.sin(hy), 0, Math.cos(hy)], scale: [bo.scale, bo.scale, bo.scale] });
              return true;
            }
          }
          o = o.parent;
        }
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
      clearBaked(); clearBuilder(); setSelected(null); return false;
    };

    const spawnAhead = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      const p = hits.length ? hits[0].point.clone() : ro.clone().addScaledVector(rd, 5);
      p.y += 0.5;
      addObject({ id: crypto.randomUUID(), modelUrl: 'builtin:box', pos: [p.x, p.y, p.z], quat: [...IDENTITY_QUAT], scale: [1, 1, 1] });
    };

    // ^wa → drop a flat water surface a few metres ahead and auto-select it so it can be carried
    // immediately. It's a normal placed object (shared via world_objects); default 6×6 footprint.
    const spawnWater = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd);
      const p = ro.clone().addScaledVector(rd, 6);
      const id = crypto.randomUUID();
      addObject({ id, modelUrl: 'builtin:water', pos: [p.x, p.y, p.z], quat: [...IDENTITY_QUAT], scale: [6, 6, 6] });
      setSelected(id);
    };

    // F → shore-seek: flood the SELECTED water object outward from its position at its current height,
    // filling the basin up to the surrounding terrain/rock/tree walls. Press F again after dropping a
    // rock in a leak to re-seal. The fill is stepped over frames in the carry loop (no hitch). Returns
    // false (key not handled) unless a water object is selected, so F stays free otherwise.
    const floodSelectedWater = (): boolean => {
      const o = current();
      if (!o || o.modelUrl !== 'builtin:water') return false;
      floodJob.current = beginFlood(o.pos[0], o.pos[2], o.pos[1], o.id);
      return true;
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
      grab.current.startX = o.pos[0]; grab.current.startZ = o.pos[2];
      grab.current.moved = false;
      // Carry by the HORIZONTAL aim only (yaw + walking move it on the ground; looking up/down does
      // NOT). This decouples pitch from horizontal position, so wheel-raise is pure vertical and you
      // can tilt your view to follow a rising object without it drifting sideways. Reach is the fixed
      // horizontal distance to the pivot, locked now — robust at any angle. The offset makes a plain
      // click a perfect no-op (target = pivot until you actually move the mouse).
      let hl = Math.hypot(rd.x, rd.z);
      if (hl < 1e-3) hl = 1;
      grab.current.hdx = rd.x / hl; grab.current.hdz = rd.z / hl;
      grab.current.reach = Math.max(MIN_REACH, Math.hypot(o.pos[0] - ro.x, o.pos[2] - ro.z));
      grab.current.offsetX = (ro.x + grab.current.hdx * grab.current.reach) - o.pos[0];
      grab.current.offsetZ = (ro.z + grab.current.hdz * grab.current.reach) - o.pos[2];
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
      // macOS Chrome turns Option+wheel into HORIZONTAL scrolling: deltaY arrives as 0 and the
      // movement shows up in deltaX. Reading deltaY alone therefore made Option+wheel (scale) do
      // nothing at all. Take whichever axis actually moved.
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const dir = delta < 0 ? 1 : -1;          // wheel up = raise / +rotation / +scale
      const pf = getProfile();
      const grabbing = grab.current.active;
      const ax = axisHeld.current;
      if (ax) {                                  // per-axis STRETCH (hold X/Y/Z + wheel)
        const f = Math.pow(pf.scaleStep, dir);
        const s: [number, number, number] = [o.scale[0], o.scale[1], o.scale[2]];
        const i = ax === 'x' ? 0 : ax === 'y' ? 1 : 2;
        s[i] = clampScale(s[i] * f);
        const next: TRS = { pos: o.pos, quat: o.quat, scale: s };
        if (grabbing) dragTo(next); else transformSelected(next);
      } else if (e.shiftKey) {                   // rotate yaw
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

    // Known typed codes → action. ^wf floods the selected water — a robust alternative to the F key,
    // which on builder maps the Terrain brush swallows (F = lower terrain).
    const CODES: Record<string, () => void> = { wa: spawnWater, wf: floodSelectedWater };
    // Recognise the "^" that starts a code (the '^' character, or Shift+6 across layouts). We use '^'
    // rather than '*' because the weapon-tuning lineup consumes '*' when it's open.
    const isCmdKey = (e: KeyboardEvent) =>
      e.key === '^' || (e.shiftKey && e.code === 'Digit6');

    // ── keys ──
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlDown.current = true;
      if (isTypingTarget(e)) return;
      if (e.code === 'Backquote' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (getCanEdit()) { toggleEditMode(); if (!getEditMode()) { grab.current.active = false; } e.preventDefault(); }
        return;
      }
      if (!getEditMode()) return;
      // Typed spawn codes. Pressing ^ arms command mode; while armed, letters build the code (and are
      // swallowed so they don't walk the player) until it matches or dead-ends.
      if (isCmdKey(e)) { cmdArmed = true; cmdBuf = ''; e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (cmdArmed) {
        if (e.key === 'Escape') { cmdArmed = false; cmdBuf = ''; return; }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const cand = cmdBuf + e.key.toLowerCase();
          if (CODES[cand]) { CODES[cand](); cmdArmed = false; cmdBuf = ''; e.preventDefault(); e.stopImmediatePropagation(); return; }
          if (Object.keys(CODES).some((k) => k.startsWith(cand))) { cmdBuf = cand; e.preventDefault(); e.stopImmediatePropagation(); return; }
          cmdArmed = false; cmdBuf = '';   // dead end — fall through so this key acts normally
        } else if (e.key.length !== 1) return;   // modifier keydown (Shift etc.) — stay armed, ignore
      }
      // ESC ALWAYS LETS GO. Previously Escape only cleared the typed-command buffer, so an object
      // picked up in Arrange stayed stuck to the pointer with no way to release it, and the key fell
      // through to the game instead. Now it drops whatever is held, clears the selection, and is
      // swallowed so it cannot also pause/exit out of the world.
      if (e.key === 'Escape') {
        // Drop it WHERE IT IS rather than snapping it back. "Let go" is what was asked for, and a
        // silent revert after carrying something across the map reads as the object disappearing.
        if (grab.current.active) { grab.current.active = false; dragCommit(); }
        clearBaked(); clearBuilder(); setSelected(null);
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.code === 'KeyZ') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && e.code === 'KeyX') { e.preventDefault(); e.stopImmediatePropagation(); deleteSelected(); return; }
      if (meta && e.code === 'KeyS') { e.preventDefault(); e.stopImmediatePropagation(); saveWorldToDb(); return; }
      if (meta) return;
      // Hold X / Y / Z to arm per-axis stretch; the wheel then scales just that axis.
      const lk = e.key.toLowerCase();
      if (lk === 'x' || lk === 'y' || lk === 'z') axisHeld.current = lk;
      let handled = true;
      switch (e.code) {
        case 'KeyP': spawnAhead(); break;
        case 'KeyF': handled = floodSelectedWater(); break;
        case 'Delete': case 'Backspace': deleteSelected(); break;
        case 'Escape': if (isDragging()) { dragCancel(); grab.current.active = false; } else setSelected(null); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlDown.current = false;
      const lk = e.key.toLowerCase();
      if ((lk === 'x' || lk === 'y' || lk === 'z') && axisHeld.current === lk) axisHeld.current = null;
    };

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
    // Advance an in-progress shore-seek flood (runs whether or not something is grabbed). Probes the
    // top solid surface from just above the waterline so the waterline geometry — shore, rocks, tree
    // trunks — acts as the wall, while high canopy overhead is ignored.
    if (floodJob.current) {
      const job = floodJob.current;
      const ceil = job.level + FLOOD_CEIL;
      // Top SOLID surface = the higher of object colliders (probed just above the waterline so canopy
      // overhead is ignored) and the terrain heightfield. Terrain counts as a wall too, so the flood
      // works on brush/heightmap maps (a terrain-only volcano) exactly like it does around objects.
      const done = stepFlood(job, (x, z) => {
        const m = meshGroundHeight(x, z, ceil);
        const t = sampleHeight(x, z);
        return m == null ? t : t == null ? m : Math.max(m, t);
      }, FLOOD_PER_FRAME);
      if (done) { setObjectFlood(job.objId, finishFlood(job) ?? undefined); floodJob.current = null; }
    }
    if (!grab.current.active || !getEditMode()) return;
    const o = current(); if (!o) { grab.current.active = false; return; }
    camera.getWorldPosition(ro); camera.getWorldDirection(rd);
    // Horizontal-aim carry: position from the yaw-only direction at the locked reach, minus the grab
    // offset. Pitch (looking up/down) is intentionally ignored so it never drags the object sideways.
    const hl = Math.hypot(rd.x, rd.z);
    if (hl > 1e-3) { grab.current.hdx = rd.x / hl; grab.current.hdz = rd.z / hl; }  // else keep last (looking straight up/down)
    const rawX = ro.x + grab.current.hdx * grab.current.reach - grab.current.offsetX;
    const rawZ = ro.z + grab.current.hdz * grab.current.reach - grab.current.offsetZ;
    // Do NOTHING until the cursor has actually moved the object (>5cm) — a static click never nudges
    // it, and grid-snap never fires on select. Height (wheel) and Ctrl-snap still apply on their own.
    if (!grab.current.moved && Math.hypot(rawX - grab.current.startX, rawZ - grab.current.startZ) > 0.05) grab.current.moved = true;
    const heightChanged = grab.current.planeY !== o.pos[1];
    if (!grab.current.moved && !ctrlDown.current && !heightChanged) return;
    const x = grab.current.moved ? snapAxis(rawX) : o.pos[0];   // grid snap only once truly moving
    const z = grab.current.moved ? snapAxis(rawZ) : o.pos[2];
    let y = grab.current.planeY;
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
