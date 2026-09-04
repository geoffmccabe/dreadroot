// StarblinkButton — top-right hex button that leaves DreadRoot for Starblink, the land
// world. Starblink is a SEPARATE app in its own repo (/Users/geoffreymccabe/starblink), not
// a map in this engine, so this is a plain navigation and not a GameSwitcher entry.
//
// ⚠ Not to be confused with the map formerly called Starblink — that is now `builder-sandbox`
// (see LEGACY_MAP_IDS in src/config/worldDefinition.ts).
//
// The destination is configurable so the same build points at a local dev server, a preview
// deploy, or production: set VITE_STARBLINK_URL. Without it, dev falls back to the Starblink
// dev server's port (8081, chosen so both can run side by side) and production to the live site.
import React from 'react';

const FALLBACK = import.meta.env.DEV ? 'http://localhost:8081' : 'https://starblink.lightningworks.io';
const STARBLINK_URL = (import.meta.env.VITE_STARBLINK_URL as string | undefined) || FALLBACK;

const panel: React.CSSProperties = {
  borderRadius: 'var(--hud-radius)',
  border: '1px solid hsla(var(--hud-border))',
  background: 'hsla(var(--hud-bg))',
  color: 'hsl(var(--hud-text))',
  fontFamily: 'var(--hud-font)',
  userSelect: 'none',
};

export function StarblinkButton() {
  return (
    <div
      onClick={() => { window.location.href = STARBLINK_URL; }}
      title="Starblink — the land world"
      style={{
        ...panel,
        position: 'fixed', top: '8px', right: '52px', zIndex: 30,
        height: '36px', padding: '0 12px',
        display: 'flex', alignItems: 'center', gap: '7px',
        fontSize: '12px', letterSpacing: '0.06em', fontWeight: 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: '16px', lineHeight: 1 }}>⬡</span>
      STARBLINK
    </div>
  );
}
