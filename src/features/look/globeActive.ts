// globeActive — is the Mini Earth map ACTUALLY on screen right now?
//
// Geoff: "you have fucked up the lighting on the entire game now! When I'm in SWU now the lighting
// is blown out on the characters."
//
// My fault, and this is the missing piece. The Mini Earth settings live in a PERSISTED store, so
// `enabled` stays true across maps and across sessions — that is what makes the panel useful. But
// LookComposer is global: it renders for every world. It was checking `enabled` alone, so the moment
// the Mini Earth panel was switched on, its grade — contrast up, saturation down, a vignette — was
// applied to Siege Worlds, the lobby, and everything else. Raised contrast is exactly what "blown
// out on the characters" looks like.
//
// "Is the feature enabled" and "are we on the map it belongs to" are two different questions, and I
// had only been asking the first. Anything scoped to one map must ask both.
//
// A module flag rather than a store: it is read during render by a component that must not
// re-subscribe, and it is owned by exactly one mounter (GlobeLighting).

let active = false;

export function setGlobeActive(v: boolean): void { active = v; }
export function isGlobeActive(): boolean { return active; }
