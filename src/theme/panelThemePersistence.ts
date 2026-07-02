// Per-GAME persistence for the panel themes. Loads this game's saved themes on
// boot into the store (so every panel renders them) and saves edits back,
// debounced. Keyed by GAME_ID — DreadRoot / Pinkland / Siege each keep their own
// row even though they share one Supabase. Until the `panel_themes` table exists
// the load no-ops and the built-in DEFAULT_PANEL_THEMES are used.
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { GAME_ID } from '@/config/game';
import { panelThemeStore } from './panelThemeStore';
import { DEFAULT_PANEL_THEMES, PANEL_CLASSES, TEXT_ROLES, type GamePanelThemes } from './panelTheme';

// Deep-merge a saved (possibly older/partial) theme blob onto the current
// defaults, so newly-added fields (e.g. `darken`, or a new class) always resolve.
function mergeWithDefaults(loaded: unknown): GamePanelThemes {
  const base: GamePanelThemes = JSON.parse(JSON.stringify(DEFAULT_PANEL_THEMES));
  const L = loaded as Partial<GamePanelThemes> | null;
  if (!L) return base;
  for (const cls of PANEL_CLASSES) {
    const lc = L[cls];
    if (!lc) continue;
    if (lc.surface) base[cls].surface = { ...base[cls].surface, ...lc.surface };
    if (lc.text) for (const role of TEXT_ROLES) {
      if (lc.text[role]) base[cls].text[role] = { ...base[cls].text[role], ...lc.text[role] };
    }
  }
  return base;
}

export function usePanelThemePersistence() {
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load once on boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('panel_themes').select('themes').eq('game', GAME_ID).maybeSingle();
        if (!cancelled && data?.themes) panelThemeStore.set(mergeWithDefaults(data.themes));
      } catch {
        /* table not created yet — keep defaults */
      } finally {
        loaded.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Save on change (debounced), but never before the initial load has settled.
  useEffect(() => {
    const unsub = panelThemeStore.subscribe(() => {
      if (!loaded.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        supabase.from('panel_themes').upsert(
          { game: GAME_ID, themes: panelThemeStore.get(), updated_at: new Date().toISOString() },
          { onConflict: 'game' },
        ).then(undefined, () => { /* ignore (offline / table missing) */ });
      }, 400);
    });
    return () => { unsub(); if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);
}
