// Global panel-theme store. External store (useSyncExternalStore) so the live
// editor, the provider that writes CSS vars, and any panel can all read/write
// the same theme object across the app — including across the R3F Canvas
// boundary. Seeded from DEFAULT_PANEL_THEMES; the editor mutates it for live
// preview and the persistence layer (later phase) hydrates it on load + saves
// on change.
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_PANEL_THEMES, cloneThemes,
  type GamePanelThemes, type PanelClass, type PanelSurface, type PanelText, type TextRole,
} from './panelTheme';

let themes: GamePanelThemes = cloneThemes(DEFAULT_PANEL_THEMES);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const panelThemeStore = {
  get: (): GamePanelThemes => themes,
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },

  /** Replace the whole theme set (e.g. hydrate from DB). */
  set: (next: GamePanelThemes) => { themes = next; emit(); },

  /** Patch one class's surface fields (live editing). */
  patchSurface: (cls: PanelClass, patch: Partial<PanelSurface>) => {
    themes = { ...themes, [cls]: { ...themes[cls], surface: { ...themes[cls].surface, ...patch } } };
    emit();
  },

  /** Patch one text role within one class (live editing). */
  patchText: (cls: PanelClass, role: TextRole, patch: Partial<PanelText>) => {
    const t = themes[cls].text;
    themes = { ...themes, [cls]: { ...themes[cls], text: { ...t, [role]: { ...t[role], ...patch } } } };
    emit();
  },

  /** Restore one class (or all) to factory defaults. */
  reset: (cls?: PanelClass) => {
    if (!cls) { themes = cloneThemes(DEFAULT_PANEL_THEMES); }
    else { themes = { ...themes, [cls]: cloneThemes(DEFAULT_PANEL_THEMES)[cls] }; }
    emit();
  },
};

export function usePanelThemes(): GamePanelThemes {
  return useSyncExternalStore(panelThemeStore.subscribe, panelThemeStore.get, panelThemeStore.get);
}
