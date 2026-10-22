---
paths:
  - "src/components/**"
  - "src/pages/**"
  - "src/features/**/*.tsx"
  - "src/theme/**"
  - "src/index.css"
  - "tailwind.config.ts"
---

# UI styling rules (load whenever UI files are touched)

Before changing any UI, read docs/STYLE_GUIDE.md. Then:
- Never hard-code a colour, size, font, radius, shadow, blur, or spacing value. Use the theme module (`src/theme/` panel tokens, `src/index.css` base tokens via Tailwind classes). Missing value: add the token first.
- Every floating panel uses `src/components/ui/GamePanel.tsx`.
- Use the shared styled pieces in `src/components/ui/` for tooltips, right-click menus, dropdowns, selects, sliders, checkboxes, switches, dialogs, scroll areas. Never the browser `title` tooltip, native `<select>`, native range slider, or `alert()`/`confirm()`.
- Never add a UI element Geoff didn't ask for. No toasts unless asked. No hover-only information.
- Run the checklist in docs/STYLE_GUIDE.md section 5 before calling the work done.
