// Panel theme model — the editable style tokens for the game's three panel
// CLASSES: User, Admin, Debug. One PanelTheme per class. The provider turns
// these objects into CSS custom properties on :root (--pt-<class>-*), so every
// panel that reads those vars restyles live + per-game.
//
// The DEFAULTS below reproduce the CURRENT look exactly, with one intentional
// exception called out in the spec: the Admin class gets a bright-blue border
// (everything else identical to User). Wiring this up therefore changes nothing
// visible except that one Admin border — until someone edits a value.
//
// "All colors MUST be HSL" (see index.css) — so every color is an {h,s,l} plus
// a separate opacity, which the editor's color picker + transparency slider map
// onto cleanly, and which compose to `hsl(h s% l% / a)` at apply time.

export interface Hsl { h: number; s: number; l: number }

export interface PanelSurface {
  bg: Hsl; bgOpacity: number;
  border: Hsl; borderOpacity: number; borderWidth: number; // px
  radius: number;   // px — corner rounding
  blur: number;     // px backdrop blur (0 = none)
  darken: number;   // 0..1 — darken the content behind the panel (0.2 = -20%)
  glow: Hsl; glowOpacity: number; glowSize: number; // px — focus glow ring
}

// The named, consistent text locations every panel should use.
export type TextRole = 'heading' | 'subheading' | 'body' | 'info' | 'micro';
export const TEXT_ROLES: TextRole[] = ['heading', 'subheading', 'body', 'info', 'micro'];

export interface PanelText {
  family: string;        // CSS font-family
  size: number;          // px
  weight: number;        // 400 / 600 / 700
  italic: boolean;
  color: Hsl; colorOpacity: number;
  letterSpacing: number; // em
}

export interface PanelTheme {
  surface: PanelSurface;
  text: Record<TextRole, PanelText>;
}

export type PanelClass = 'user' | 'admin' | 'debug';
export const PANEL_CLASSES: PanelClass[] = ['user', 'admin', 'debug'];
export type GamePanelThemes = Record<PanelClass, PanelTheme>;

// ── default value helpers ───────────────────────────────────────────────────
const INTER = "'Inter', sans-serif";
const MONO = 'ui-monospace, monospace';

function txt(
  family: string, size: number, weight: number, color: Hsl,
  colorOpacity = 1, italic = false, letterSpacing = 0,
): PanelText {
  return { family, size, weight, italic, color, colorOpacity, letterSpacing };
}

// User panel — the current `.user-panel-dialog` look (HUD blue, light-grey border).
const USER: PanelTheme = {
  surface: {
    bg: { h: 211, s: 30, l: 51 }, bgOpacity: 0.35,            // --hud-bg
    border: { h: 211, s: 34, l: 73 }, borderOpacity: 0.8, borderWidth: 1, // --hud-border
    radius: 6,
    blur: 12,        // darkened-glass: blur the scene behind
    darken: 0.2,     // ...and darken it 20%
    glow: { h: 210, s: 90, l: 60 }, glowOpacity: 0.6, glowSize: 22, // --panel-glow
  },
  text: {
    heading:    txt(INTER, 14, 700, { h: 211, s: 32, l: 90 }),
    subheading: txt(INTER, 13, 600, { h: 211, s: 32, l: 90 }),
    body:       txt(INTER, 13, 400, { h: 211, s: 32, l: 90 }),
    info:       txt(INTER, 11, 400, { h: 211, s: 32, l: 70 }),
    micro:      txt(INTER, 10, 400, { h: 211, s: 32, l: 70 }),
  },
};

// Admin panel — IDENTICAL to User, except a bright-blue border (per spec).
const ADMIN: PanelTheme = {
  surface: {
    ...USER.surface,
    border: { h: 210, s: 100, l: 60 }, borderOpacity: 1, borderWidth: 1, // bright blue
  },
  text: {
    heading:    { ...USER.text.heading },
    subheading: { ...USER.text.subheading },
    body:       { ...USER.text.body },
    info:       { ...USER.text.info },
    micro:      { ...USER.text.micro },
  },
};

// Debug panel — the Siege Debug / Laser Inspector look (dark green, monospace).
const DEBUG: PanelTheme = {
  surface: {
    bg: { h: 150, s: 50, l: 6 }, bgOpacity: 0.82,            // rgba(8,24,16,0.82)
    border: { h: 147, s: 50, l: 57 }, borderOpacity: 0.55, borderWidth: 1, // rgba(90,200,140,0.55)
    radius: 12,
    blur: 0,
    darken: 0,
    glow: { h: 147, s: 50, l: 57 }, glowOpacity: 0.4, glowSize: 10,
  },
  text: {
    heading:    txt(MONO, 13, 700, { h: 144, s: 67, l: 70 }),            // #7fe6a8 teal
    subheading: txt(MONO, 12, 600, { h: 0, s: 0, l: 100 }, 0.92),
    body:       txt(MONO, 12, 400, { h: 0, s: 0, l: 100 }, 0.92),        // rgba(255,255,255,0.92)
    info:       txt(MONO, 11, 400, { h: 0, s: 0, l: 100 }, 0.55),
    micro:      txt(MONO, 10, 400, { h: 0, s: 0, l: 100 }, 0.55),
  },
};

export const DEFAULT_PANEL_THEMES: GamePanelThemes = { user: USER, admin: ADMIN, debug: DEBUG };

// Deep clone so callers (store, editor) can mutate without touching the frozen defaults.
export function cloneThemes(t: GamePanelThemes): GamePanelThemes {
  return JSON.parse(JSON.stringify(t));
}

// ── theme object → CSS custom properties ─────────────────────────────────────
function hsl(c: Hsl, opacity: number): string {
  return `hsl(${c.h} ${c.s}% ${c.l}% / ${opacity})`;
}

/** Flatten the three themes into the full `--pt-<class>-*` variable map. */
export function themeToVars(themes: GamePanelThemes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cls of PANEL_CLASSES) {
    const p = `--pt-${cls}`;
    const s = themes[cls].surface;
    out[`${p}-bg`] = hsl(s.bg, s.bgOpacity);
    out[`${p}-border`] = hsl(s.border, s.borderOpacity);
    out[`${p}-border-w`] = `${s.borderWidth}px`;
    out[`${p}-radius`] = `${s.radius}px`;
    // Composite backdrop-filter: blur the scene behind + darken it.
    const filter: string[] = [];
    if (s.blur > 0) filter.push(`blur(${s.blur}px)`);
    if (s.darken > 0) filter.push(`brightness(${(1 - s.darken).toFixed(3)})`);
    out[`${p}-blur`] = filter.length ? filter.join(' ') : 'none';
    out[`${p}-glow`] = hsl(s.glow, s.glowOpacity);
    out[`${p}-glow-size`] = `${s.glowSize}px`;
    for (const role of TEXT_ROLES) {
      const t = themes[cls].text[role];
      const rp = `${p}-${role}`;
      out[`${rp}-family`] = t.family;
      out[`${rp}-size`] = `${t.size}px`;
      out[`${rp}-weight`] = String(t.weight);
      out[`${rp}-style`] = t.italic ? 'italic' : 'normal';
      out[`${rp}-color`] = hsl(t.color, t.colorOpacity);
      out[`${rp}-ls`] = `${t.letterSpacing}em`;
    }
  }
  return out;
}
