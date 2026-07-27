// kaijuDiag — one shared record of what the Kaiju is actually doing, so the HUD can report it.
//
// Added because "I see no Kaiju" is unfalsifiable from the outside: the model might not have
// loaded, or it might be loaded and placed somewhere off screen, or placed correctly and hidden
// by something else. Those need completely different fixes, and static reading of the code had
// already sent me down the wrong path once.

export const kaijuDiag = {
  /** Has the glTF finished loading? */
  loaded: false,
  /** Distance from the camera in game units. */
  dist: 0,
  /** Angle between the camera's view direction and the Kaiju, in degrees. >35 is off screen. */
  offAxisDeg: 0,
  /** Rendered height in units. */
  height: 0,
  /** Whether the transform contains a NaN, which makes an object silently vanish. */
  finite: true,
};
