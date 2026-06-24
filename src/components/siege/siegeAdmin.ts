// Bridges the player's admin/superadmin role (known in the DOM HUD via AuthContext) to the in-Canvas
// siege code (which has no auth context), so admin-only features — e.g. the Apocalypse City Jump entry
// — can gate on it. FortressHUD calls setSiegeAdmin when roles resolve.
let admin = false;
export const setSiegeAdmin = (v: boolean): void => { admin = v; };
export const getSiegeAdmin = (): boolean => admin;
