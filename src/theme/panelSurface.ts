// panelSurface — the inline style that drives a panel's chrome from the live, admin-editable panel
// theme tokens (--pt-<class>-*), the SAME ones AdminPanel/UserPanel use. Spread it onto a panel's
// outer element so editing the theme (Admin → Worlds → Settings → CSS) restyles the panel live.
//   <div style={{ ...panelSurface('admin'), boxShadow: glow.boxShadow }} />
import type { CSSProperties } from 'react';
import type { PanelClass } from './panelTheme';

export function panelSurface(cls: PanelClass): CSSProperties {
  return {
    background: `var(--pt-${cls}-bg)`,
    border: `var(--pt-${cls}-border-w) solid var(--pt-${cls}-border)`,
    borderRadius: `var(--pt-${cls}-radius)`,
    backdropFilter: `var(--pt-${cls}-blur)`,
    WebkitBackdropFilter: `var(--pt-${cls}-blur)`,
  };
}
