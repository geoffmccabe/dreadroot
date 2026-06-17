// AUTO-GENERATED. Monster SFX + ambient music served from /public, for the SW game audio system.
// Regenerate if public/monster-sounds or public/music changes.
export interface GameSound { file: string; bytes: number; }

export const MONSTER_SOUNDS: Record<string, GameSound> = {
  "boss_mushroom_footsteps": { file: "/monster-sounds/boss_mushroom_footsteps.mp3", bytes: 98473 },
  "demon_attack": { file: "/monster-sounds/demon_attack.mp3", bytes: 15404 },
  "GroundSlam": { file: "/monster-sounds/GroundSlam.mp3", bytes: 49292 },
  "mushroom_gurgle": { file: "/monster-sounds/mushroom_gurgle.mp3", bytes: 207247 },
  "Mushroom_Shriek_Medium": { file: "/monster-sounds/Mushroom_Shriek_Medium.mp3", bytes: 207247 },
  "Mutant_Jump": { file: "/monster-sounds/Mutant_Jump.mp3", bytes: 23365 },
  "Mutant_Stab": { file: "/monster-sounds/Mutant_Stab.mp3", bytes: 16469 },
  "Pigman_Swing": { file: "/monster-sounds/Pigman_Swing.mp3", bytes: 12140 },
  "Spores_Attack": { file: "/monster-sounds/Spores_Attack.mp3", bytes: 13752 },
  "Spores_Sound": { file: "/monster-sounds/Spores_Sound.mp3", bytes: 70707 },
  "Throw_Grunt": { file: "/monster-sounds/Throw_Grunt.mp3", bytes: 23157 },
  "zombie_moan_3p1": { file: "/monster-sounds/zombie_moan_3p1.mp3", bytes: 111325 },
  "zombie_moan_3p2": { file: "/monster-sounds/zombie_moan_3p2.mp3", bytes: 66186 },
  "zombie_moan_6p1": { file: "/monster-sounds/zombie_moan_6p1.mp3", bytes: 37346 },
};

export const MUSIC_TRACKS: Record<string, GameSound> = {
  "ambient_wind": { file: "/music/ambient_wind.mp3", bytes: 21356 },
  "BackgroundSound_Ambient": { file: "/music/BackgroundSound_Ambient.mp3", bytes: 612991 },
  "bleakrock_ambient": { file: "/music/bleakrock_ambient.mp3", bytes: 292076 },
  "harold_neighborhood_ambient": { file: "/music/harold_neighborhood_ambient.mp3", bytes: 470636 },
  "main_theme": { file: "/music/main_theme.mp3", bytes: 1676478 },
  "portal_idle": { file: "/music/portal_idle.mp3", bytes: 144866 },
  "RomanBackground": { file: "/music/RomanBackground.mp3", bytes: 3157307 },
};
