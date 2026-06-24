// Writes the active panel themes into the document as CSS custom properties
// (--pt-<class>-*) on :root, and keeps them in sync whenever the store changes
// (live editor edits or DB hydration). Renders nothing. Mount once, high in the
// tree. Panels read the vars via their CSS classes / inline styles.
import { useEffect } from 'react';
import { themeToVars, type GamePanelThemes } from './panelTheme';
import { usePanelThemes } from './panelThemeStore';

export function applyPanelThemeVars(themes: GamePanelThemes): void {
  const root = document.documentElement;
  const vars = themeToVars(themes);
  for (const k in vars) root.style.setProperty(k, vars[k]);
}

export function PanelThemeProvider() {
  const themes = usePanelThemes();
  useEffect(() => { applyPanelThemeVars(themes); }, [themes]);
  return null;
}
