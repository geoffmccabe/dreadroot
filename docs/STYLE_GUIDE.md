# DreadRoot style guide (read before ANY UI work)

Last reviewed: 2026-Oct-22. Standard: ~/.claude/docs/PROJECT_DOCS_STANDARD.md section 7.
Auto-loaded reminder for UI files: .claude/rules/ui-styling.md.

## 1. The look

Dark, glassy game HUD floating over the 3D world. Panels are tinted, see-through glass that blurs and slightly darkens the scene behind them, with a soft blue glow when they open, move, or resize. Text is crisp Inter (monospace for debug and build tools). Nothing should ever look like a default web page or a grey operating-system control: every menu, tooltip, slider and dropdown is part of the game's glass HUD.

Four panel classes, each with its own look (all editable live in Admin, Worlds, Settings, CSS):
| Class | Used for | Look |
|---|---|---|
| User | Player-facing panels | Blue-grey glass, light blue-grey border, Inter |
| Admin | Build/management tools (gear hub + tabs) | Same as User, bright-blue border, darker backdrop, white headings |
| Debug | Coding / diagnostics overlays | Dark green glass, green border, teal monospace headings (Laser Inspector look) |
| Build | In-world build tools (Terrain, Object Placer, Arrange) | Neutral dark glass, subtle border, rounded 16px, monospace |

## 2. The theme module (ESSENTIAL: the only place styling values live)

- **`src/theme/panelTheme.ts`**: the token model and defaults for the four panel classes (surface colour, opacity, border, radius, blur, backdrop darkening, glow; five text roles: heading, subheading, body, info, micro). Colours are HSL + opacity.
- **`src/theme/PanelThemeProvider.tsx` + `panelThemeStore.ts` + `panelThemePersistence.ts`**: turn the tokens into CSS variables on the page root (`--pt-user-*`, `--pt-admin-*`, `--pt-debug-*`, `--pt-build-*`), live-update them from the editor, and save them per game.
- **`src/index.css`** `:root` variables: the base design tokens used by the shared UI pieces (background, foreground, card, popover, primary, accent, border, input, ring, radius, font sizes, spacing). All colours HSL.
- **`tailwind.config.ts`**: maps those variables to the utility classes. Use the named classes (e.g. `bg-popover`, `text-muted-foreground`), never raw colour values.

Rules:
- Never write a colour, size, font, radius, shadow, blur, or spacing value directly in a component, inline style, or className. Read a token (`var(--pt-<class>-...)` or a Tailwind token class).
- Need a value that doesn't exist? Add it to the theme module first (to `panelTheme.ts` if it's panel-specific, so it shows up in the live editor; to `index.css` if it's a base token), then use it.
- Small controls get their own named tokens too (tooltip background, menu hover, slider track/fill/thumb, scrollbar), built from the base values, so they can be tuned in one place.
- When you touch a file that hard-codes styling, move those values into tokens as part of the change.
- 3D-world colours (materials, lights, particles) aren't UI, but still belong in named config, not scattered literals.

## 3. Shared components (always use these, never hand-roll or use raw browser controls)

| Job | Use | Never |
|---|---|---|
| Any floating panel | `src/components/ui/GamePanel.tsx` (drag by top edge, resize from bottom-right corner, blur, glow) | Hand-made panels or fixed boxes |
| Tooltip | `src/components/ui/tooltip.tsx` (styled with theme tokens) | The browser `title` attribute popup |
| Right-click menu | `src/components/ui/context-menu.tsx` | Custom divs, or the browser's own menu |
| Dropdown menu | `src/components/ui/dropdown-menu.tsx` | |
| Select / pick-one list | `src/components/ui/select.tsx` | Native `<select>` (renders grey) |
| Slider | `src/components/ui/slider.tsx` | Native range input |
| Checkbox / toggle / switch / radio | `checkbox.tsx`, `switch.tsx`, `toggle.tsx`, `radio-group.tsx` | Native inputs |
| Confirm / warning | `alert-dialog.tsx` or `dialog.tsx` inside the theme | Browser `alert()` / `confirm()` popups |
| Scrolling area in a panel | `scroll-area.tsx` | Default scrollbars |
| Number inputs | `input.tsx`, allowing empty while typing | |

If a shared piece doesn't match the theme yet (some still use the light base tokens), fix the shared piece once so every use is fixed. Also set the page-level dark colour scheme so any native control that slips through renders dark.

## 4. Current state (measured 2026-Oct-22, so agents know the debt)

- About 1,300 hard-coded colour values across 177 of 409 component files.
- 124 browser `title` tooltips, 45 native dropdowns, 9 native sliders, 15 browser alert/confirm popups.
- The base `:root` tokens in `src/index.css` are a LIGHT palette (sky blue / white cards), left over from the original scaffold, while the game HUD is dark. Shared pieces like popovers, selects and tooltips that read the base tokens can therefore come out light or grey. Fixing the base tokens to the dark HUD palette is the highest-value single styling fix.
- No page-level dark colour-scheme setting yet.
- Only 6 panels use GamePanel so far.

Reduce these numbers whenever you touch the related files; never add to them.

## 5. Checklist before calling UI work done

- No new hard-coded colours, sizes, fonts, spacing, or shadows outside the theme module.
- Panels use GamePanel; drag, resize, blur, glow all work.
- Tooltips, right-click menus, dropdowns, selects (including the open list), sliders (track, fill, thumb, and the panel behind them), checkboxes, toggles, number inputs, scrollbars all match the panel class.
- Hover, pressed, disabled, loading, empty, and error states designed.
- Keyboard focus outline visible and on-theme.
- No browser alert/confirm popups; no hover-only information.
- Works at phone width and full desktop width; nothing overflows.
- No new UI element that Geoff didn't ask for.
- Look at a screenshot if one is available instead of assuming.
