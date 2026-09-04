// GameSwitcher — top-right ⚔️ icon (same panel styling as the rest of the HUD). Click to
// open a small dropdown of the games sharing this one engine: Dreadroot, Siege Worlds, and
// Pinkland (greyed for now). Selecting one sets the runtime active game (see activeGame.ts),
// which the app reads on boot to load that game's world/modules + styling. A universal-engine
// control: it lives in the engine HUD, available to every game.
import React, { useState } from 'react';
import { setActiveGame, useActiveGame } from '@/config/activeGame';
import { GAME_LIST } from '@/config/gameRegistry';
import { topRightY } from '@/lib/embedded';

const GAMES = GAME_LIST;

const panel: React.CSSProperties = {
  borderRadius: 'var(--hud-radius)',
  border: '1px solid hsla(var(--hud-border))',
  background: 'hsla(var(--hud-bg))',
  color: 'hsl(var(--hud-text))',
  fontFamily: 'var(--hud-font)',
  userSelect: 'none',
};

// Pinned top-right. When the game is framed (the Alien Worlds wallet), it drops below the host's
// own "✕ Close" button, which otherwise sits directly on top of it and hides the switcher.
export function GameSwitcher() {
  const [open, setOpen] = useState(false);
  const active = useActiveGame();
  return (
    <div style={{ position: 'fixed', top: `${topRightY()}px`, right: '8px', zIndex: 30 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        title="Switch game"
        style={{ ...panel, width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', cursor: 'pointer' }}
      >
        ⚔️
      </div>
      {open && (
        <div style={{ ...panel, marginTop: '6px', minWidth: '150px', overflow: 'hidden' }}>
          {GAMES.map((g) => (
            <div
              key={g.id}
              onClick={() => { if (g.enabled) { setActiveGame(g.id); setOpen(false); } }}
              style={{
                padding: '8px 12px', fontSize: '13px',
                opacity: g.enabled ? 1 : 0.4,
                cursor: g.enabled ? 'pointer' : 'not-allowed',
                fontWeight: active === g.id ? 700 : 400,
                background: active === g.id ? 'hsla(var(--hud-highlight))' : 'transparent',
              }}
            >
              {g.label}{g.enabled ? '' : ' (soon)'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
