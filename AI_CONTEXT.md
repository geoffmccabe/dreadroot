# AI_CONTEXT.md
A low token project map for LLM coding assistants (Claude Code, ChatGPT, Copilot Chat).

## Goal
Help an assistant make correct edits while opening the smallest possible set of files.

## Quick start commands
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck (if present): `npm run typecheck`
- Tests (if present): `npm test`

## High level architecture
- Frontend: React + TypeScript + Vite
- 3D and game loop: react three fiber (R3F) and Three.js
- Auth and data: Supabase, IndexedDB caching
- Feature focus: Fortress gameplay experience

## Key entry points
- App shell and routing: `src/App.tsx`
- Fortress page container: `src/components/fortress/Fortress.tsx`
- Fortress scene render and frame loop: `src/components/fortress/FortressScene.tsx`
- Fortress input and interaction: `src/components/fortress/FortressControls.tsx`
- Global contexts used by Fortress:
  - `src/contexts/BlocksContext.tsx`
  - `src/contexts/AuthContext.tsx`
  - `src/contexts/BulletDefinitionsContext.tsx`
  - `src/contexts/CoinThemeContext.tsx`
  - `src/contexts/InitializationContext.tsx`

## Fortress folder map
- Composition and layout
  - `src/components/fortress/Fortress.tsx`
  - `src/components/fortress/FortressHUD.tsx`
  - `src/components/fortress/FortressOverlays.tsx`
  - `src/components/fortress/FortressProviders.tsx`
- Scene logic
  - `src/components/fortress/FortressScene.tsx` (thin orchestrator)
  - `src/components/fortress/FortressScene.CameraTrackedBlocks.tsx`
  - `src/components/fortress/FortressScene.WispParticlesMesh.tsx`
  - `src/components/fortress/useFortressFrameLoop.ts`
  - `src/components/fortress/useFortressShooting.ts`
  - `src/components/fortress/fortressScene.constants.ts`

## Chunk loading and world streaming
- Hook entry: `src/hooks/useChunkLoader.ts`
- Split modules:
  - `src/hooks/chunkLoader.constants.ts`
  - `src/hooks/chunkLoader.colliders.ts`
  - `src/hooks/chunkLoader.compare.ts`
  - `src/hooks/chunkLoader.cache.ts`

## Admin UI
- Entry: `src/components/AdminPanel.tsx`
- Split modules:
  - `src/components/AdminPanel.WaterfallControls.tsx`
  - `src/components/AdminPanel.WeatherControls.tsx`
  - `src/components/AdminPanel.UsersList.tsx`
  - `src/components/AdminPanel.BlocksList.tsx`
  - `src/components/adminPanel.types.ts`

## Token saving rules for assistants
These rules are intended to be pasted into Claude Code or any repo tool.

### File open policy
1) Do not scan the repo.
2) Start from the symptom and open only the minimum file set.
3) Prefer opening 1 file first, then expand only if errors demand it.
4) If you need a second file, explain why before opening it.

### What to ignore unless explicitly required
- `node_modules/`
- `dist/`, `build/`, `.next/`
- lockfiles like `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- generated or vendor code
- large assets under `public/` (images, audio, models)
- Supabase generated types unless the task is type related:
  - `src/integrations/supabase/types.ts`

### Preferred edit format
- Prefer diffs or minimal replacements.
- If a change is localized, edit only the function or component involved.
- Avoid rewriting entire files unless needed for correctness.

### Minimal context bundle to request
When starting a task, ask for:
- the error stack trace, including the first line with file and line number
- steps to reproduce
- the single file from the stack trace
Then stop. Only request additional files after confirming the first file does not contain the fix.

## Common tasks and where to look first
- Blank screen, R3F crash, context lost:
  - `FortressScene.tsx`, `useFortressFrameLoop.ts`, `FortressScene.CameraTrackedBlocks.tsx`
- Input, pointer lock, camera look, movement:
  - `FortressControls.tsx` (and any split control hooks if created)
- Chunk streaming, popping, missing blocks:
  - `useChunkLoader.ts` and the `chunkLoader.*.ts` helpers
- HUD, overlays, panels not showing:
  - `FortressHUD.tsx`, `FortressOverlays.tsx`, `AdminPanel.tsx`

## Prompt template for low token work
Paste this into your assistant:

"""
Before opening files, list the 3 to 7 most likely files and why.
Open only the top 1 file first.
Do not scan the repo.
Ignore build outputs, lockfiles, generated code, and large assets unless required.
Make the smallest possible patch that fixes the symptom.
"""
