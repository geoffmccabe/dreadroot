// lineupWeapons — the two-handed guns shown in the character lineup's hands during the rifle
// animations. Each entry is one weapon MODEL plus its grip transform in the Hand_R local frame.
//
// Why this stays tiny: scale is NOT here. The attach (LineupWeapon) measures the model's real size
// AND the character's hand size at runtime and computes the scale to hit `lengthM`, so one set of
// numbers seats a gun correctly on EVERY character regardless of hand size — no per-character table.
// Only ROTATION + grip POSITION are authored (they live in the shared Mixamo hand frame, identical
// across characters), so each weapon is calibrated ONCE, not once-per-character.
export interface LineupWeaponDef {
  name: string;
  url: string;
  lengthM: number;                    // target real-world length of the model's longest axis (metres)
  rotDeg: [number, number, number];   // orientation in the Hand_R local frame (eye-calibrated, shared)
  gripPos: [number, number, number];  // grip offset in Hand_R local metres (eye-calibrated, shared)
  sizeByChar?: Record<string, number>;  // baked per-character size multiplier; default 1
  rotByChar?: Record<string, [number, number, number]>;   // baked per-character rotDeg (else rotDeg)
  gripByChar?: Record<string, [number, number, number]>;  // baked per-character gripPos (else gripPos)
  leftHand?: { point: [number, number, number]; wrist: number };  // baked support-hand grip (gun-local) + wrist°
}

// First-pass grip guesses — SIZE is auto-correct; rotation/position need a visual tuning pass.
// Barrel axis (from each model's bbox): rifle/shotgun run along Z, the sniper/scifi guns along X.
export const WEAPONS: LineupWeaponDef[] = [
  { name: 'Rifle',          url: '/siege/weapons/rifle.glb',               lengthM: 1.1, rotDeg: [0, 0, 0],   gripPos: [0, 0, 0] },
  { name: 'Shotgun',        url: '/siege/weapons/shotgun.glb',             lengthM: 1.0, rotDeg: [0, 0, 0],   gripPos: [0, 0, 0] },
  { name: 'Sniper',         url: '/siege/weapons/sniper.glb',              lengthM: 1.4, rotDeg: [0, -90, 0], gripPos: [0, 0, 0] },
  { name: 'Scifi Assault',  url: '/siege/weapons/scifi_assault_rifle.glb', lengthM: 1.0, rotDeg: [0, -90, 0], gripPos: [0, 0, 0] },
  { name: 'Scifi Sniper',   url: '/siege/weapons/scifi_sniper.glb',        lengthM: 1.4, rotDeg: [0, -90, 0], gripPos: [0, 0, 0] },
  { name: 'Rocket Launcher',url: '/siege/weapons/rocket_launcher.glb',     lengthM: 1.2, rotDeg: [0, -90, 0], gripPos: [0, 0, 0] },
];
