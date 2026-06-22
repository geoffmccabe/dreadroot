// Named areas of the Siege Worlds open-world map + teleport destinations.
//
// ── NAMING NOTE (we deliberately leave the legacy code as-is) ────────────────
// The mushroom island has several names in the original Unity/Java source:
//   • Location.Mushrooms        — the canonical location enum value
//   • GameInstanceType.Fumarole — the instance/zone type you portal into
//   • "Bleakrock"               — its theme (from the `bleakrock_ambient` track)
//   • "StarBlind"               — an enemy WAVE there (not the place itself)
// In THIS port we call it "Bleakrock". So for future reference:
//     Fumarole  ==  Bleakrock  ==  the Mushrooms island.
// (Renaming the legacy "Fumarole" was NOT done — it's a server/network/asset
//  identifier with ~248 references across the Java server + Unity + serialized
//  data, so a blind rename would risk breaking instance routing / saved data.)
//
// Harold is a SEPARATE instance (you portal into it), not part of this open-world
// map, so its teleport is a placeholder — use Shift+4 to save your own spot.

export interface SiegeTeleport {
  slot: number;
  name: string;
  pos: [number, number, number]; // engine coords (X = -UnityX); Y a touch above ground
  yaw?: number;                  // facing (radians) applied on jump; undefined = keep current facing
  pitch?: number;                // look up/down (radians); usually 0
  mapId?: string;                // which world/map this area lives in (default 'siege-test').
                                 // The map is intrinsic to the area — jumping here switches to it.
}

// Centroids measured from the exported placement data; Y nudged up so you drop
// onto the terrain. Slots 4 (Harold) and 5 (Nero) are best-guesses — overwrite
// them in-game with Shift+<n> once you're standing where you want them.

// Where the player spawns / respawns in Siege Worlds — Bleakrock (the Mushrooms island), just
// above its ground (~24) so you drop onto terrain. Used by the initial spawn AND death respawn.
export const SIEGE_SPAWN_POINT: [number, number, number] = [-1048.998, 31.120, 1062.865];

export const SIEGE_TELEPORTS: SiegeTeleport[] = [
  { slot: 1, name: 'Lobby',         pos: [-96, 31, 325] },
  { slot: 2, name: 'Beach',         pos: [-537, 46, 688] },
  { slot: 3, name: 'Bleakrock',     pos: [-1039, 24, 1108] },
  { slot: 4, name: 'Harold',        pos: [-1039, 24, 1108] }, // separate instance — Shift+4 to set
  { slot: 5, name: "Nero's Island", pos: [-1484, 82, 690] },  // best guess — Shift+5 to set
  { slot: 6, name: 'Gauntlet',      pos: [-1484, 82, 690] },
  { slot: 7, name: 'Shanty',        pos: [-394, 32, 744] },
  { slot: 8, name: 'Jungle',        pos: [-733, 29, 651] },
  // Builder sandbox — its OWN map (flat editable terrain), reached like any other area.
  { slot: 9, name: 'Starblink',     pos: [0, 3, 0], mapId: 'starblink' },
];

/**
 * Baked Synty asset-set demos — each its OWN map, reached by Ctrl/Cmd+J then a LETTER.
 * Only sets that ship a fully-assembled scene FBX appear here (City, Space). Component-only
 * sets (CyberCity, Mech, SciFi Worlds) have no baked scene → they belong in the builder.
 */
export interface SiegeDemoMap { code: string; key: string; name: string; mapId: string; pos: [number, number, number]; }
export const SIEGE_DEMOS: SiegeDemoMap[] = [
  { code: 'KeyA', key: 'A', name: 'SciFi City',  mapId: 'city-demo',   pos: [0, 3, 0] },
  { code: 'KeyB', key: 'B', name: 'SciFi Space', mapId: 'space-demo',  pos: [0, 3, 0] },
  // Component-only sets shown as auto-arranged sampler grids.
  { code: 'KeyC', key: 'C', name: 'CyberCity',   mapId: 'cyber-demo',  pos: [0, 3, 0] },
  { code: 'KeyD', key: 'D', name: 'Mech',        mapId: 'mech-demo',   pos: [0, 3, 0] },
  { code: 'KeyE', key: 'E', name: 'SciFi Worlds', mapId: 'worlds-demo', pos: [0, 3, 0] },
  { code: 'KeyF', key: 'F', name: 'Apocalypse',  mapId: 'apoc-demo',   pos: [0, 3, 0] },
  { code: 'KeyG', key: 'G', name: 'Dark Fantasy', mapId: 'dark-demo',  pos: [0, 3, 0] },
  // Nature biomes (asset libraries → future biome-painting palette).
  { code: 'KeyH', key: 'H', name: 'Nature',         mapId: 'nature-demo', pos: [0, 3, 0] },
  { code: 'KeyI', key: 'I', name: 'Alpine Mountain', mapId: 'alpine-demo', pos: [0, 3, 0] },
  { code: 'KeyJ', key: 'J', name: 'Arid Desert',    mapId: 'desert-demo', pos: [0, 3, 0] },
  { code: 'KeyK', key: 'K', name: 'Meadow Forest',  mapId: 'meadow-demo', pos: [0, 3, 0] },
  { code: 'KeyL', key: 'L', name: 'Swamp Marshland', mapId: 'swamp-demo', pos: [0, 3, 0] },
  { code: 'KeyM', key: 'M', name: 'Tropical Jungle', mapId: 'jungle-demo', pos: [0, 3, 0] },
  // Baked assembled scene (like City/Space) — a full fantasy village to walk around.
  { code: 'KeyN', key: 'N', name: 'Adventure Town', mapId: 'adventure-demo', pos: [0, 3, 0] },
  // "Various 2" component sampler grids (loose pieces for map/challenge building).
  { code: 'KeyO', key: 'O', name: 'Adventure Pieces', mapId: 'adventure-grid', pos: [0, 3, 0] },
  { code: 'KeyP', key: 'P', name: 'Ancient Empire',  mapId: 'ancient-grid',   pos: [0, 3, 0] },
  { code: 'KeyQ', key: 'Q', name: 'Dungeon Props',   mapId: 'dungeon-grid',   pos: [0, 3, 0] },
  { code: 'KeyR', key: 'R', name: 'Elven Realm',     mapId: 'elven-grid',     pos: [0, 3, 0] },
  { code: 'KeyS', key: 'S', name: 'Enchanted Forest', mapId: 'enchanted-grid', pos: [0, 3, 0] },
  { code: 'KeyT', key: 'T', name: 'Fantasy Kingdom', mapId: 'kingdom-grid',   pos: [0, 3, 0] },
  { code: 'KeyU', key: 'U', name: 'Samurai Empire',  mapId: 'samurai-grid',   pos: [0, 3, 0] },
];
