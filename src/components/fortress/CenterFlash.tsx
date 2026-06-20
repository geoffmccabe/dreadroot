// Renders the centered flash message (NO WEAPON EQUIPPED, etc). Shows on each
// flashCenter() call and fades after ~0.9s; a new flash restarts it.
import { useEffect, useState } from 'react';
import { useCenterFlash } from '@/config/centerFlash';

export function CenterFlash() {
  const { msg, at } = useCenterFlash();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!at) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), 900);
    return () => clearTimeout(t);
  }, [at]);

  if (!msg) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', top: '40%', left: 0, right: 0, textAlign: 'center',
        color: '#fff', fontSize: 30, fontWeight: 800, letterSpacing: '0.06em',
        textShadow: '0 2px 10px rgba(0,0,0,0.9)', fontFamily: 'var(--hud-font)',
        pointerEvents: 'none', zIndex: 40,
        opacity: shown ? 1 : 0, transition: 'opacity 280ms ease-out',
      }}
    >
      {msg}
    </div>
  );
}
