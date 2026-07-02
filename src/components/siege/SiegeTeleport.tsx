// SiegeTeleport (in-Canvas) — owns the camera + the teleport keys. Ctrl/Cmd+J
// ARMS quick-travel (a styled "Jump To:" menu shows via SiegeTeleportMenu for 5s),
// then a digit 1-8 jumps. Shift+<digit> while armed SAVES your current spot AND FACING
// to that slot (localStorage), so any pad can be set exactly. A jump restores both the
// position and the view angle. Each save also logs a paste-ready pose to the console, so
// the captured spot can be baked into siegeAreas as the default for everyone. Esc cancels.

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SIEGE_TELEPORTS, SIEGE_DEMOS } from './siegeAreas';
import { setTeleportArmed, isTeleportArmed } from './teleportStore';
import { setTPDist } from './siegeThirdPerson';
import { setActiveMapId, getActiveMapId } from '@/config/activeMap';
import { setSiegePendingSpawn, setSiegeReturnPoint } from './siegePlayerState';
import { getSiegeAdmin } from './siegeAdmin';
import { isTypingTarget } from '@/lib/isTypingTarget';

const DEMO_BY_CODE = Object.fromEntries(SIEGE_DEMOS.map((d) => [d.code, d]));

const LS = 'sw_teleports_v2';
type Vec3 = [number, number, number];
interface Saved { pos: Vec3; yaw?: number; pitch?: number }

function loadOverrides(): Record<number, Saved> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || '{}') as Record<string, Saved | Vec3>;
    const out: Record<number, Saved> = {};
    for (const k of Object.keys(raw)) { const v = raw[k]; out[+k] = Array.isArray(v) ? { pos: v } : v; }  // tolerate legacy bare-array
    return out;
  } catch { return {}; }
}
function saveOverride(slot: number, s: Saved): void {
  const o = loadOverrides(); o[slot] = s;
  try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ }
}
function destFor(slot: number, overrides: Record<number, Saved>): Saved | null {
  if (overrides[slot]) return overrides[slot];
  const t = SIEGE_TELEPORTS.find((t) => t.slot === slot);
  return t ? { pos: t.pos, yaw: t.yaw, pitch: t.pitch } : null;
}

export function SiegeTeleport() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const overrides = loadOverrides();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    // The teleport store is the SINGLE source of truth for "armed" — so disarming from a
    // MENU CLICK (which only flips the store) also stops the key interception here. Keeping a
    // separate local flag caused the bug where, after clicking a Jump-To entry, the menu hid
    // but the keys stayed captured, so WASD movement (A/S/D are demo-jump letters) teleported.
    const disarm = () => { setTeleportArmed(false); };
    // No auto-dismiss timer — the menu stays open until the player picks a spot or hits Esc.
    // Free the cursor so the menu's clickable entries work in FPS pointer-lock.
    const arm = () => { setTeleportArmed(true); document.exitPointerLock?.(); };

    // Shared jump, used by the keys AND by out-of-Canvas UI (Cmd-J menu clicks +
    // the Challenges → Worlds cards) via window.__siegeJump.
    const jump = (mapId: string, pos: [number, number, number], yaw?: number, pitch?: number) => {
      setTPDist(0);   // arrive in first person — a zoomed 3rd-person camera would land inside/behind the
                      // spawn's walls (esp. the enclosed lobby). Alt+wheel back out after arriving.
      // Switching maps: hand the controller this exact spawn so its world-change reset doesn't
      // overwrite it with the map's own (often placeholder) spawn.position. Same-map jumps need no
      // pending — the direct set below is final since the controller won't re-spawn.
      if (mapId !== getActiveMapId()) {
        // Remember where we came FROM (this map + current spot/facing) so the death screen's RETURN
        // can send the player back there.
        euler.setFromQuaternion(camera.quaternion, 'YXZ');
        setSiegeReturnPoint({ mapId: getActiveMapId(), pos: [camera.position.x, camera.position.y, camera.position.z], yaw: euler.y, pitch: euler.x });
        setSiegePendingSpawn({ pos, yaw, pitch });
      }
      setActiveMapId(mapId);
      camera.position.set(pos[0], pos[1], pos[2]);
      if (yaw != null) {
        const setView = (window as unknown as { __siegeSetView?: (y: number, p?: number) => void }).__siegeSetView;
        if (setView) setView(yaw, pitch ?? 0);
        else camera.quaternion.setFromEuler(euler.set(pitch ?? 0, yaw, 0, 'YXZ'));
      }
    };
    (window as unknown as { __siegeJump?: typeof jump }).__siegeJump = jump;

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;   // never hijack typing in a panel field
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyJ') {     // ARM
        e.preventDefault(); e.stopPropagation(); arm(); return;
      }
      if (!isTeleportArmed()) return;
      if (e.code === 'Escape') { e.preventDefault(); disarm(); return; }
      // Custom-key areas (e.g. Bleakrock 2 on '!', which sits after the 0-9 digit slots).
      if (e.key.length === 1 && !/[0-9]/.test(e.key)) {
        const t = SIEGE_TELEPORTS.find((x) => x.key === e.key);
        if (t) { e.preventDefault(); e.stopPropagation(); jump(t.mapId ?? 'siege-test', t.pos, t.yaw, t.pitch); disarm(); return; }
      }
      // Letter = jump to a baked asset-set demo map (each is its own map). adminOnly maps (e.g. the
      // in-progress Apocalypse City) only jump for admins.
      const demo = DEMO_BY_CODE[e.code];
      if (demo && (!demo.adminOnly || getSiegeAdmin())) {
        e.preventDefault(); e.stopPropagation();
        jump(demo.mapId, demo.pos, demo.yaw, demo.pitch);
        disarm(); return;
      }
      if (/^Digit[0-9]$/.test(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const slot = parseInt(e.code.slice(5), 10);
        if (e.shiftKey) {                                       // SAVE current spot + facing
          euler.setFromQuaternion(camera.quaternion, 'YXZ');
          const s: Saved = {
            pos: [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)],
            yaw: r3(euler.y), pitch: r3(euler.x),
          };
          saveOverride(slot, s); overrides[slot] = s;
          const name = SIEGE_TELEPORTS.find((t) => t.slot === slot)?.name ?? `slot ${slot}`;
          // Paste this line back to bake it into siegeAreas as the default for everyone.
          console.log(`[SiegeTeleport] Saved ${name}: pos=[${s.pos.join(', ')}] yaw=${s.yaw} pitch=${s.pitch}`);
        } else {                                                // TELEPORT (switch map + position + view)
          const tp = SIEGE_TELEPORTS.find((t) => t.slot === slot);
          const d = destFor(slot, overrides);
          if (d) jump(tp?.mapId ?? 'siege-test', d.pos, d.yaw, d.pitch);
        }
        disarm();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setTeleportArmed(false);
      delete (window as unknown as { __siegeJump?: typeof jump }).__siegeJump;
    };
  }, [camera]);

  return null;
}
