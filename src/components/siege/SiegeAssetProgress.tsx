// SiegeAssetProgress — reports the REAL model/texture loading to the init overlay and signals when
// the world's assets have actually finished loading. drei's useProgress watches THREE's global
// loading manager, so this covers every useGLTF/useTexture load (world objects, monsters, characters,
// weapons) — the bulk of the SWW lobby load. Terrain heightfield tiles use plain fetch() and are
// reported separately by TerrainLayer.
//
// "Loaded" = the loader was active and has now been idle for a moment (debounced), so a brief gap
// between batches doesn't fire it early. If nothing ever loads (all cached), it reports ready after a
// short grace so the overlay doesn't wait on the watchdog.
import { useEffect, useRef } from 'react';
import { useProgress } from '@react-three/drei';
import { isSiegeLoadActive, siegeLoadNote } from './siegeInitLoad';

export function SiegeAssetProgress({ onAllLoaded }: { onAllLoaded: () => void }) {
  const { active, loaded, total } = useProgress();
  const wasActive = useRef(false);
  const fired = useRef(false);
  const lastNote = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = (msg: string) => {
    if (fired.current) return;
    fired.current = true;
    siegeLoadNote('Assets', msg);
    onAllLoaded();
  };

  // All-cached fallback: if nothing has started loading shortly after mount, there's nothing to wait
  // for — report ready (don't sit on the inactivity watchdog).
  useEffect(() => {
    if (!isSiegeLoadActive()) return;
    graceTimer.current = setTimeout(() => { if (!wasActive.current) finish('No new models to load (cached)'); }, 3500);
    return () => { if (graceTimer.current) clearTimeout(graceTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSiegeLoadActive() || fired.current) return;
    if (active) {
      wasActive.current = true;
      if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
      const now = performance.now();
      if (now - lastNote.current > 600) {
        lastNote.current = now;
        siegeLoadNote('Assets', `Loading models + textures: ${loaded}/${total}`);
      }
    } else if (wasActive.current) {
      // Idle after having loaded — debounce so a between-batch gap doesn't finish us early.
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => finish(`Models + textures loaded: ${total}`), 900);
    }
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loaded, total]);

  return null;
}
