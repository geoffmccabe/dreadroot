// Siege Worlds title splash — when the SW world is the active game, the logo shows
// centered over the loading map for a moment, then fades out to reveal the world.
// Pure DOM overlay (the 3D canvas/map renders behind it). Renders nothing for any
// other game, so Dreadroot is unaffected.
import { useEffect, useState } from 'react';
import { useActiveGame } from '@/config/activeGame';

export function SiegeTitleSplash() {
  const isSiege = useActiveGame() === 'siege-worlds';
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in');

  useEffect(() => {
    if (!isSiege) return;
    const t1 = setTimeout(() => setPhase('out'), 2600);   // hold, map loads behind
    const t2 = setTimeout(() => setPhase('gone'), 4400);   // after fade, unmount
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isSiege]);

  if (!isSiege || phase === 'gone') return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 45, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: phase === 'out' ? 0 : 1,
        transition: 'opacity 1.7s ease',
        background:
          phase === 'out'
            ? 'transparent'
            : 'radial-gradient(circle at center, rgba(0,0,0,0.35), rgba(0,0,0,0.65))',
      }}
    >
      <img
        src="/sww_logo_transp_v1_hq.webp"
        alt="Siege Worlds"
        style={{ maxWidth: '62vw', maxHeight: '52vh', filter: 'drop-shadow(0 0 34px rgba(0,0,0,0.85))' }}
      />
    </div>
  );
}
