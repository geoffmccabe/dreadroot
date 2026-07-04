// Live player state, written each frame by the controller and read by the HUD.
// Engine space is mirrored-X vs Unity (handedness), so we expose both.
export const playerState = {
  x: 0, y: 0, z: 0,   // engine world position
  fx: 0, fz: -1,      // forward direction (XZ), normalized
  // Movement state for the third-person self-avatar's locomotion (written by the controller).
  mf: 0,              // forward input: +1 forward, -1 backward, 0 none
  mr: 0,              // strafe input: +1 right, -1 left, 0 none
  run: false,         // sprinting (Shift)
  grounded: true,     // on the ground (vs jumping/falling)
  vy: 0,              // vertical velocity (jump up vs fall down)
  gun: false,         // weapon equipped / aiming (crosshairs on)
  gliding: false,     // holding G while airborne → glide pose + slowed fall
  boosting: false,    // jet-boost (air-jump) burn active → show foot jet flames, no jump pose
  glideFactor: 100,   // the player character's glide factor: 100 = normal fall, 200 = half speed,
                      // 50 = double speed. Set by the self-avatar from the current character.
};

/** Compass heading from a forward XZ vector. -Z = North, +X = East. */
export function heading(fx: number, fz: number): { deg: number; dir: string } {
  let deg = (Math.atan2(fx, -fz) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dir = dirs[Math.round(deg / 45) % 8];
  return { deg: Math.round(deg), dir };
}
