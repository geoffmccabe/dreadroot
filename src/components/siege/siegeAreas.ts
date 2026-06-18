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
];
