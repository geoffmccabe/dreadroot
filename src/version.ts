// Build version — bumped on EVERY code commit. Displayed in the
// HUD top-left next to the FPS readout so the user can verify
// at-a-glance which build is live on dreadroot.com.
//
// Bump rules:
//   * patch (4.1.X) — small fixes, single-file tweaks, hotfixes
//   * minor (4.X.0) — meaningful features (new RPC, new system,
//                     refactor that spans multiple files)
//   * major (X.0.0) — massive shifts (L2 DO migration, schema
//                     redesigns, paradigm changes)
//
// Do NOT touch this manually — the AI bumps it on every push.
export const APP_VERSION = '4.8.1';
