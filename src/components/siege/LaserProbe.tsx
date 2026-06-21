// LaserProbe — press L to toggle a visible laser from where you're looking. While
// on, it raycasts each frame, draws a red beam + a dot at the hit, and publishes
// what it's touching to probeState (so the C-copy in CoordsHud can report it).

import { useEffect, useMemo, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { probeState } from './probeState';
import { playerState, heading } from './playerState';

export function LaserProbe() {
  const { camera, scene } = useThree();
  const [on, setOn] = useState(false);

  const { grp, line, dot } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false, transparent: true }));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false }));
    line.renderOrder = 999; dot.renderOrder = 999;
    line.frustumCulled = false; dot.frustumCulled = false;
    // Highlight box around whatever the laser points at (works for ANY mesh, incl. the
    // plain sampler models that the instanced-tint highlight can't touch).
    const box = new THREE.BoxHelper(dot, 0xff2020);   // red highlight box around the pointed item
    (box.material as THREE.LineBasicMaterial).depthTest = false;
    box.renderOrder = 1000; box.frustumCulled = false; box.visible = false;
    const grp = new THREE.Group(); grp.add(line); grp.add(box);
    return { grp, line, dot, box };
  }, []);

  const LASER_FAR = 600;            // beam reach (m)
  const MAX_TRIS = 120000;          // skip ultra-dense meshes (e.g. 22MB wildflower patches)
                                    // whose brute-force triangle test is what froze the map
  const ray = useMemo(() => { const r = new THREE.Raycaster(); r.far = LASER_FAR; return r; }, []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const down = useMemo(() => new THREE.Vector3(), []);
  const start = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const WHITE = useMemo(() => new THREE.Color(1, 1, 1), []);
  const RED = useMemo(() => new THREE.Color(1, 0.15, 0.15), []);
  // currently-highlighted instance, so we can restore it when the aim moves
  const hl = useMemo(() => ({ mesh: null as THREE.InstancedMesh | null, id: -1 }), []);
  // Raycast throttle: intersectObjects over the whole dense scene is very heavy, so
  // run it ~12x/sec instead of every frame and keep the beam smooth in between by
  // re-projecting along the current aim at the last hit distance.
  const rc = useMemo(() => ({ last: -1, dist: 8000, hit: false }), []);
  const clearHL = () => {
    if (hl.mesh && hl.id >= 0) {
      hl.mesh.setColorAt(hl.id, WHITE);
      if (hl.mesh.instanceColor) hl.mesh.instanceColor.needsUpdate = true;
    }
    hl.mesh = null; hl.id = -1;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL') setOn((v) => {
        const nv = !v; probeState.on = nv;
        if (!nv) { probeState.mesh = null; probeState.instanceId = -1; probeState.hasHit = false; }
        return nv;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quick-tag interaction: raycast from view center, HIDE the hit instance (so it can't
  // be re-tagged this session), and send it to the triage board. Shift = instant "bad";
  // plain right-click = open the tag dropdown.
  useEffect(() => {
    const r = new THREE.Raycaster(); r.far = 8000;
    const d2 = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const probeAndHide = () => {
      camera.getWorldDirection(d2); r.set(camera.position, d2);
      const hits = r.intersectObjects(scene.children, true)
        .filter((h) => (h.object as THREE.Mesh).isMesh && h.object !== dot);
      if (!hits.length) return null;
      const h = hits[0]; const im = h.object as THREE.InstancedMesh;
      const ud = (im.userData || {}) as { fbx?: string; mesh?: string };
      const name = ud.fbx || im.name || '(unknown)';
      const sub = ud.mesh && ud.mesh !== '(whole)' ? ` / ${ud.mesh}` : '';
      const inst = h.instanceId != null ? ` [instance ${h.instanceId}]` : '';
      if (im.isInstancedMesh && h.instanceId != null) {  // hide it
        im.setMatrixAt(h.instanceId, zero); im.instanceMatrix.needsUpdate = true;
      }
      const { x, z, fx, fz } = playerState; const hd = heading(fx, fz);
      return { item: `${name}${sub}${inst}`, px: x, pz: z, deg: hd.deg, dir: hd.dir,
               hx: +h.point.x.toFixed(1), hy: +h.point.y.toFixed(1), hz: +h.point.z.toFixed(1) };
    };
    const send = (detail: object) => window.dispatchEvent(new CustomEvent('sw-triage', { detail }));
    // Pointer-lock suppresses 'contextmenu', so detect right-click via mousedown(button 2),
    // which DOES fire while locked. Shift+anyclick = instant "bad"; plain right = dropdown.
    const onMouse = (e: MouseEvent) => {
      if (!probeState.on) return;   // only tag/hide while the laser is explicitly on
      const right = e.button === 2;
      const shiftLeft = e.button === 0 && e.shiftKey;
      if (!right && !shiftLeft) return;
      const info = probeAndHide(); if (!info) return;
      if (e.shiftKey || shiftLeft) { send({ ...info, bad: true }); }
      else { document.exitPointerLock?.(); send({ ...info, menu: true }); }
    };
    const onContext = (e: MouseEvent) => e.preventDefault(); // stop the browser menu
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('contextmenu', onContext);
    return () => { window.removeEventListener('mousedown', onMouse); window.removeEventListener('contextmenu', onContext); };
  }, [camera, scene, dot]);

  useFrame(() => {
    if (!on) return;
    camera.getWorldDirection(dir);
    // Originate the visible beam below the eye (like a gun-barrel laser) so it isn't
    // edge-on to the view — the raycast itself still comes from the camera center.
    down.set(0, -1, 0).applyQuaternion(camera.quaternion);
    start.copy(camera.position).addScaledVector(dir, 1.2).addScaledVector(down, 1.0);

    // THROTTLED raycast (the expensive part) — ~8x/sec, not every frame.
    const now = performance.now();
    if (rc.last < 0 || now - rc.last > 120) {
      rc.last = now;
      ray.set(camera.position, dir);
      ray.far = LASER_FAR;
      // The freeze was a few ULTRA-high-poly meshes (e.g. 22MB wildflower patches) getting
      // brute-force ray-tested — NOT the mesh count. Give those a no-op raycast (once) so
      // they're skipped, then raycast the WHOLE scene recursively (which reliably hits the
      // normal items — the earlier candidate-cull was dropping them).
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.__laserChk) return;
        m.userData.__laserChk = true;
        const g = m.geometry as THREE.BufferGeometry | undefined;
        const tris = g ? (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3 : 0;
        if (tris > MAX_TRIS) m.raycast = () => {};   // skip in all raycasts
      });
      const hits = ray.intersectObjects(scene.children, true)
        .filter((h) => (h.object as THREE.Mesh).isMesh && h.object !== dot && h.object !== box && h.object !== line);
      if (hits.length) {
        const h = hits[0];
        rc.hit = true; rc.dist = camera.position.distanceTo(h.point);
        const ud = (h.object.userData || {}) as { fbx?: string; mesh?: string };
        const name = ud.fbx || h.object.name || '(unknown)';
        const sub = ud.mesh && ud.mesh !== '(whole)' ? ` / ${ud.mesh}` : '';
        const inst = h.instanceId != null ? ` [instance ${h.instanceId}]` : '';
        const hg = (h.object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        probeState.tris = hg ? Math.round((hg.index ? hg.index.count : (hg.getAttribute('position')?.count ?? 0)) / 3) : 0;
        probeState.dist = rc.dist;
        probeState.hasHit = true;
        probeState.hit = `${name}${sub}${inst}`;
        probeState.hx = h.point.x; probeState.hy = h.point.y; probeState.hz = h.point.z;
        probeState.mesh = h.object as THREE.Mesh;            // for the V voxelize tool
        probeState.instanceId = h.instanceId ?? -1;
        // highlight box around the pointed-at object (any mesh type)
        try { box.setFromObject(h.object); box.visible = true; } catch { box.visible = false; }
        // tint the pointed-at instance red
        const im = h.object as THREE.InstancedMesh;
        if (im.isInstancedMesh && h.instanceId != null && (hl.mesh !== im || hl.id !== h.instanceId)) {
          clearHL();
          if (!im.instanceColor) { for (let i = 0; i < im.count; i++) im.setColorAt(i, WHITE); }
          im.setColorAt(h.instanceId, RED);
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          hl.mesh = im; hl.id = h.instanceId;
        }
      } else {
        rc.hit = false;
        probeState.hasHit = false; probeState.hit = null;
        probeState.mesh = null; probeState.instanceId = -1;
        box.visible = false;
        clearHL();
      }
    }

    // Beam endpoint + dot every frame from the last hit distance (smooth aim).
    if (rc.hit) { end.copy(camera.position).addScaledVector(dir, rc.dist); dot.visible = true; dot.position.copy(end); }
    else { end.copy(camera.position).addScaledVector(dir, ray.far); dot.visible = false; }
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
  });

  return on ? <primitive object={grp} /> : null;
}
