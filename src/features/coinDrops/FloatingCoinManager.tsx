/**
 * FloatingCoinManager — renders + drives the Minecraft-style floating coin drops.
 * See docs/COIN_DROPS.md. Mounted once inside the 3D scene.
 *
 * Per coin type (token_theme) it draws one billboarded, glowing instanced sprite layer
 * (reusing the waterfall-coin look). Each drop spawns `float_count` units that pop out,
 * settle + bob, then magnetically fly to the eligible player and auto-collect on contact
 * (→ pickup_coin_drop credits the balance). All motion/look knobs come from config.ts.
 *
 * Slice 3 scope: the local player's own kills (always eligible). The 60s public window
 * for OTHER players' drops + cross-client persistence land in Slice 4.
 */
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { frameLoop } from '@/lib/frameLoop';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { worldStore } from '@/services/worldStore';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { setCoinDropListener } from './coinDropBus';
import { DEFAULT_COIN_DROP_BEHAVIOR as CFG, OWNERSHIP_WINDOW_MS } from './config';
import type { CoinDropInstance } from './types';

/** Pickup sound: the waterfall coin-shot sound at half volume + half pitch (lower). */
function playPickupSound(): void {
  try {
    const a = new Audio(getSoundUrl('coin_hit', '/coin_hit_sound.mp3'));
    a.volume = 0.15;      // 50% of the waterfall coin volume (0.3)
    a.playbackRate = 0.5; // 50% pitch — lower
    a.play().catch(() => {});
  } catch { /* ignore */ }
}

const MAX_PER_THEME = 256;

interface Unit {
  dropId: string; themeId: string; amount: number; killer: string | null; bornMs: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  baseY: number; phase: number; scale: number;
  state: 'fall' | 'idle' | 'magnet' | 'dead';
}

export function FloatingCoinManager({ userId }: { userId: string | null }) {
  const { camera } = useThree();
  const [themes, setThemes] = useState<{ id: string; tex: THREE.Texture }[]>([]);
  const unitsRef = useRef<Unit[]>([]);
  const collectingRef = useRef<Set<string>>(new Set());
  const meshRefs = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const userIdRef = useRef(userId); userIdRef.current = userId;

  // Load coin textures (one per active token_theme).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('token_themes' as never)
        .select('id, coin_image_url, is_active');
      if (!alive || !data) return;
      const loader = new THREE.TextureLoader();
      const list = (data as unknown as Record<string, unknown>[])
        .filter(t => t.is_active && t.coin_image_url)
        .map(t => {
          const tex = loader.load(t.coin_image_url as string);
          tex.colorSpace = THREE.SRGBColorSpace;
          return { id: t.id as string, tex };
        });
      if (alive) setThemes(list);
    })();
    return () => { alive = false; };
  }, []);

  // Spawn units when a kill rolls coins.
  useEffect(() => setCoinDropListener((drops: CoinDropInstance[]) => {
    const now = performance.now();
    for (const d of drops) {
      const count = Math.max(1, Math.min(10, d.float_count));
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.8;
        const r = CFG.spawnScatterRadius * (0.3 + Math.random() * 0.7);
        unitsRef.current.push({
          dropId: d.id, themeId: d.token_theme_id, amount: d.amount,
          killer: d.killer_user_id, bornMs: now,
          x: d.position_x + Math.cos(a) * r,
          y: d.position_y + 1.0,
          z: d.position_z + Math.sin(a) * r,
          vx: Math.cos(a) * 1.5,
          vy: CFG.spawnUpVelocity * (0.7 + Math.random() * 0.6),
          vz: Math.sin(a) * 1.5,
          baseY: d.position_y + CFG.settleHeight,
          phase: Math.random() * Math.PI * 2,
          scale: CFG.scale * (1 + (Math.random() - 0.5) * CFG.scaleJitter * 2),
          state: 'fall',
        });
      }
    }
  }), []);

  // Physics + render, driven by the shared frame loop.
  useEffect(() => {
    const m = new THREE.Matrix4(); const p = new THREE.Vector3();
    const q = new THREE.Quaternion(); const s = new THREE.Vector3();

    const collect = (dropId: string) => {
      if (collectingRef.current.has(dropId)) return;
      collectingRef.current.add(dropId);
      worldStore.pickupCoinDrop(dropId).then(res => {
        if (res && res.ok) {
          playPickupSound();
          for (const u of unitsRef.current) if (u.dropId === dropId) u.state = 'dead';
        } else if (res && res.reason === 'not_yours_yet') {
          collectingRef.current.delete(dropId); // still in someone else's window — retry later
        } else {
          for (const u of unitsRef.current) if (u.dropId === dropId) u.state = 'dead'; // gone/already
        }
      }).catch(() => collectingRef.current.delete(dropId));
    };

    const unregister = frameLoop.register('coinDrops', (delta) => {
      const units = unitsRef.current;
      const meshes = meshRefs.current;
      if (units.length === 0) { meshes.forEach(mesh => { if (mesh.count !== 0) mesh.count = 0; }); return; }

      const dt = Math.min(delta, 0.05);
      const now = performance.now();
      const uid = userIdRef.current;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      let hasDead = false;

      for (const u of units) {
        if (u.state === 'dead') { hasDead = true; continue; }

        if (u.state === 'fall') {
          u.vy -= CFG.gravity * dt;
          u.x += u.vx * dt; u.y += u.vy * dt; u.z += u.vz * dt;
          u.vx *= 0.92; u.vz *= 0.92;
          // Land on whatever solid surface is below — so coins rest at the body's
          // FINAL spot (ground, or a tree branch if the corpse is up in a tree),
          // not mid-air where a falling/airborne kill happened.
          if (u.vy < 0) {
            const below = Math.floor(u.y - 0.15);
            if (worldCollisionGrid.hasVoxel(Math.floor(u.x), below, Math.floor(u.z))) {
              u.baseY = below + 1 + 0.2;       // rest on the block top, slight hover
              u.y = u.baseY; u.state = 'idle';
            } else if (u.y <= 0.4) {           // safety floor if nothing solid below
              u.baseY = 0.4; u.y = 0.4; u.state = 'idle';
            }
          }
        }

        const dx = cx - u.x, dy = (cy - 0.4) - u.y, dz = cz - u.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        const eligible = u.killer === uid || (now - u.bornMs > OWNERSHIP_WINDOW_MS);

        // Magnet only when the player is close (any kill, any weapon). Coins stay
        // at the death spot until someone gets near.
        if (eligible && u.state !== 'fall' && dist < CFG.magnetRange) u.state = 'magnet';

        if (u.state === 'magnet') {
          const accel = 1 + (CFG.magnetRange - Math.min(dist, CFG.magnetRange)) / CFG.magnetRange;
          const step = CFG.magnetSpeed * dt * accel;
          const inv = 1 / dist;
          u.x += dx * inv * step; u.y += dy * inv * step; u.z += dz * inv * step;
          if (dist < CFG.collectRange) collect(u.dropId);
        } else if (u.state === 'idle') {
          u.phase += dt * CFG.bobFrequencyHz * Math.PI * 2;
          u.y = u.baseY + Math.sin(u.phase) * CFG.bobAmplitude;
        }
      }

      if (hasDead) unitsRef.current = units.filter(u => u.state !== 'dead');

      // Write matrices per coin-type mesh (billboard to the camera).
      camera.getWorldQuaternion(q);
      for (const [themeId, mesh] of meshes) {
        let n = 0;
        for (const u of unitsRef.current) {
          if (u.themeId !== themeId || u.state === 'dead') continue;
          if (n >= MAX_PER_THEME) break;
          p.set(u.x, u.y, u.z);
          s.set(u.scale, u.scale, 1);
          m.compose(p, q, s);
          mesh.setMatrixAt(n, m);
          n++;
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }, 35);
    return unregister;
  }, [camera, themes]);

  return (
    <>
      {themes.map(t => (
        <instancedMesh
          key={t.id}
          ref={(mesh) => { if (mesh) { mesh.count = 0; meshRefs.current.set(t.id, mesh); } }}
          args={[undefined, undefined, MAX_PER_THEME]}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={t.tex}
            transparent
            depthWrite={false}
            opacity={CFG.baseOpacity}
            side={THREE.DoubleSide}
            blending={CFG.glowAdditive ? THREE.AdditiveBlending : THREE.NormalBlending}
            alphaTest={CFG.glowAdditive ? 0 : 0.5}
          />
        </instancedMesh>
      ))}
    </>
  );
}
