/**
 * Your own body in DreadRoot.
 *
 * Until now DreadRoot rendered no player body at all — the local avatar was
 * behind a hard-coded `false`, so you were a floating camera. This turns it on.
 *
 * IT STARTS AT 25% OPACITY ON PURPOSE. A body attached to a first-person camera
 * is very likely to sit wrong or block the view before it is tuned, and a ghost
 * is easy to see past while that is being sorted out. The level is a setting,
 * not a constant, so it can be dialled up as it improves:
 *
 *     __avatar.opacity(0.6)    __avatar.off()    __avatar.on()
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { playerState } from '@/components/siege/playerState';
import { useTPDist } from '@/components/siege/siegeThirdPerson';
import { useActiveWeapon } from '@/config/activeWeapon';
import { useSelectedCharacter } from '../characterSelection';
import { DREADROOT_CHARACTERS } from '../dreadrootCharacters';
import { CharacterAvatar } from './CharacterAvatar';
import type { MoveInput } from './movementState';

const DEFAULT_OPACITY = 0.25;

/** The weapon the model should be holding. */
function useFireWeaponOrActive() {
  return useActiveWeapon();
}

const store = {
  opacity: DEFAULT_OPACITY,
  enabled: true,
  /**
   * How far BEHIND the camera the head sits, and how far BELOW the camera the
   * eye line is trimmed. Both live, because these are the numbers I keep
   * getting wrong by reasoning about them instead of looking at them.
   *
   * `back` had to grow when the frame-order fix landed: the body used to be
   * drawn at last frame's position — i.e. BEHIND you when moving — so part of
   * the offset was accidental lag. Removing the lag removed that, and the
   * tuned number was suddenly too small, which put the camera back inside the
   * face. Tuning it by hand from a fresh guess is how that repeats, so it is
   * adjustable at runtime instead:
   *
   *     __avatar.back(0.3)    push the body further behind the camera
   *     __avatar.eye(-0.05)   nudge the eye line down (negative) or up
   *     __avatar.get()        read the current values back to me
   */
  back: 0.22,
  eyeTrim: 0,
  /** Show the body in FIRST person too. Off by default — see the note at the
   *  render below for why that costs so much. __avatar.on() enables it. */
  forceFirstPerson: false,
  listeners: new Set<() => void>(),
  set(patch: Partial<{ opacity: number; enabled: boolean; back: number; eyeTrim: number; forceFirstPerson: boolean }>) {
    Object.assign(store, patch);
    store.listeners.forEach((l) => l());
  },
};

export const DreadrootSelfAvatar: React.FC = () => {
  const character = useSelectedCharacter();
  const tpDist = useTPDist();
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    store.listeners.add(l);
    const w = window as unknown as { __avatar?: unknown };
    w.__avatar = {
      opacity: (v: number) => store.set({ opacity: Math.max(0, Math.min(1, v)) }),
      /** Force the body visible in FIRST person, for tuning the offsets.
       *  Expect a heavy frame-rate cost while it is on: the body sits at the
       *  camera and fills the screen. */
      on: () => store.set({ enabled: true, forceFirstPerson: true }),
      off: () => store.set({ forceFirstPerson: false }),
      /** Hide it everywhere, third person included. */
      hide: () => store.set({ enabled: false }),
      /** Metres the head sits BEHIND the camera. Bigger = camera further in
       *  front of the face. */
      back: (v: number) => store.set({ back: v }),
      /** Metres to shift the eye line. NEGATIVE lowers the camera relative to
       *  the head; positive raises it. */
      eye: (v: number) => store.set({ eyeTrim: v }),
      get: () => ({
        character, opacity: store.opacity, enabled: store.enabled,
        back: store.back, eyeTrim: store.eyeTrim,
        forceFirstPerson: store.forceFirstPerson,
      }),
    };
    return () => { store.listeners.delete(l); };
  }, [character]);

  const getInput = useCallback((): MoveInput => ({
    mf: playerState.mf, mr: playerState.mr,
    run: playerState.run, grounded: playerState.grounded,
    vy: playerState.vy, gliding: playerState.gliding,
    boosting: playerState.boosting,
  }), []);

  /**
   * The controller publishes the EYE; the body stands on the ground below it —
   * by THIS character's eye height, not a shared guess. A single 1.6 put the
   * camera inside Ash's hat, because his head sits lower in his silhouette
   * than Rajax's.
   *
   * The body is also nudged BACKWARD along the look direction, so the camera
   * ends up just in front of the face rather than inside the skull. First
   * person with a visible body always has that problem; most games hide the
   * head, but seeing yourself is the point of the ghost.
   */
  const getPosition = useCallback((out: THREE.Vector3) => {
    const c = DREADROOT_CHARACTERS.find((x) => x.name === character) ?? DREADROOT_CHARACTERS[0];
    // fx/fz point FORWARD, so subtracting moves the body BACK — the camera
    // ends up in front of the face.
    out.set(
      playerState.x - playerState.fx * store.back,
      playerState.y - (c.eyeH + store.eyeTrim),
      playerState.z - playerState.fz * store.back,
    );
  }, [character]);

  /**
   * Facing. NO extra half-turn.
   *
   * These models' forward is +Z, so atan2(fx, fz) ALREADY turns them to face
   * the look direction — it returns cameraYaw + PI. Adding another PI put the
   * body back-to-front, which only showed when knockback separated you from it
   * and you saw your own avatar looking at you. The Siege self-avatar has
   * always used exactly this line; I should have copied it rather than
   * re-deriving it.
   */
  const getYaw = useCallback(
    () => Math.atan2(playerState.fx, playerState.fz),
    [],
  );

  const thirdPerson = tpDist > 0.05;
  // Whatever is actually in the player's hand right now. The fire weapon is
  // the one that matters — with dual wield the right hand and the firing hand
  // can differ, and the model should show what you are shooting with.
  const activeWeapon = useFireWeaponOrActive();
  const weaponItem = activeWeapon?.itemNumber ?? null;

  /**
   * YOUR OWN BODY, with the HEAD REMOVED in first person.
   *
   * You can never see your own head, so drawing it only ever caused harm: it
   * sat at the camera, filled the entire viewport at zero distance, and — while
   * it was translucent to "stay out of the way" — alpha-blended every pixel of
   * the screen with depth writes off. That took the game from ~27fps to 2. The
   * camera being inside the face and the frame rate collapsing were one bug.
   *
   * Collapsing the head instead of hiding the whole body means the parts you
   * CAN legitimately see — arms, torso, legs, the weapon in your hands — stay
   * visible, and it needs no transparency at all. Solid materials, no
   * overdraw, and nothing to tune.
   */
  if (!store.enabled) return null;

  /**
   * ALWAYS MOUNTED, HIDDEN IN FIRST PERSON — never unmounted.
   *
   * This used to return null in first person, so scrolling out to third person
   * MOUNTED the avatar from scratch: five model loads, a suspend, and roughly
   * 74 animation actions built in one go. That is a two-second freeze on a grey
   * screen every time you change view, because a suspending component inside
   * the Canvas takes the whole Canvas down while it waits.
   *
   * Keeping it mounted pays that cost ONCE, at world load, alongside everything
   * else that is loading anyway. Switching view is then just a visibility flag,
   * which is free.
   *
   * `visible={false}` skips rendering entirely in three.js, so first person
   * costs no more than returning null did — it simply does not throw the work
   * away and redo it. The head is still collapsed for first person so that
   * zooming back in cannot flash a face across the view.
   */

  return (
    <CharacterAvatar
      character={character}
      getInput={getInput}
      getPosition={getPosition}
      getYaw={getYaw}
      visible={thirdPerson}
      hideHead={!thirdPerson}
      weaponItemNumber={weaponItem}
      reloadSeconds={activeWeapon?.reloadTime ?? null}
      opacity={1}
      armed={playerState.gun}
    />
  );
};

/** Read by anything that wants to respect the current setting. */
export function selfAvatarOpacity(): number { return store.opacity; }
