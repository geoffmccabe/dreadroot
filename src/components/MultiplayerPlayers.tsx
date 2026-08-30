/**
 * Everyone else, rendered as the character THEY picked.
 *
 * This used to load y-bot.fbx — the default Mixamo test dummy — for every
 * player, ignore their chosen character entirely, and animate two states: walk
 * and idle, inferred from whether their position had changed. So multiplayer
 * meant a field of identical grey mannequins that could stand or shuffle.
 *
 * Now each remote player is their real character, driven by the SAME animator
 * and the SAME clip sets as your own body, off the movement bits their client
 * publishes. A remote player is not a poorer kind of thing than you are.
 *
 * Interpolation is unchanged: positions still come from the shared transform
 * buffer, which holds rather than extrapolates when packets are late.
 */
import React, { useCallback, useMemo, useRef, Suspense } from 'react';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text } from '@react-three/drei';
import { remotePlayerBuffer, type SampledTransform } from '@/features/netcode/transformBuffer';
import { frameLoop } from '@/lib/frameLoop';
import { CharacterAvatar } from '@/features/characters/animation/CharacterAvatar';
import type { MoveInput } from '@/features/characters/animation/movementState';
import { dropToGround } from '@/features/parkour';

interface MultiplayerPlayersProps {
  players: Map<string, PlayerState>;
}

/** Camera height above the feet — the published position is the eye. */
const EYE_HEIGHT = 1.6;
const NAME_HEIGHT = 2.1;

function OtherPlayer({ player }: { player: PlayerState }) {
  // Held in a ref and read inside the frame callback: the player object is
  // replaced on every network update, and re-creating the callbacks each time
  // would restart the animator's frame work for no reason.
  const latest = useRef(player);
  latest.current = player;

  const sample = useRef<SampledTransform>({ x: 0, y: 0, z: 0, yaw: 0, speed: 0 });

  const getPosition = useCallback((out: THREE.Vector3) => {
    const p = latest.current;
    // sample() writes into the caller-owned object and returns whether it had
    // anything — it does NOT return the transform. Interpolated when available,
    // otherwise the raw update.
    const ok = remotePlayerBuffer.sample(p.userId, performance.now(), sample.current);
    const s = sample.current;
    if (ok) out.set(s.x, s.y - EYE_HEIGHT, s.z);
    else out.set(p.position.x, p.position.y - EYE_HEIGHT, p.position.z);
  }, []);

  const getYaw = useCallback(() => {
    const p = latest.current;
    const ok = remotePlayerBuffer.sample(p.userId, performance.now(), sample.current);
    // The half-turn DOES belong here. The wire carries the sender's raw camera
    // yaw, and these models face +Z, so they need cameraYaw + PI to look the
    // way the player is looking — the same value atan2(fx, fz) produces for the
    // local body. The previous renderer used no offset because it drew y-bot,
    // whose forward is the other way round; I took that as the rule and got it
    // backwards for the real characters.
    return (ok ? sample.current.yaw : p.rotation.yaw) + Math.PI;
  }, []);

  /** Throttled drop measurement — see the note at its call site. */
  const dropCache = useRef({ at: 0, value: Infinity });
  const cachedDrop = useCallback((p: PlayerState) => {
    const now = performance.now();
    if (now - dropCache.current.at >= 120) {
      dropCache.current.at = now;
      dropCache.current.value = dropToGround(p.position.x, p.position.y - EYE_HEIGHT, p.position.z);
    }
    return dropCache.current.value;
  }, []);

  const getInput = useCallback((): MoveInput => {
    const p = latest.current;
    return {
      mf: p.mf ?? 0,
      mr: p.mr ?? 0,
      run: !!p.run,
      grounded: p.grounded !== false,
      vy: p.vy ?? 0,
      gliding: !!p.gliding,
      // Jet-boost is a visual on the owner's client (boot flames) and only
      // changes the airborne pose, so it is not worth a wire field.
      boosting: false,
      // Measured locally from their published position rather than sent: the
      // world is the same on every client, so this costs nothing on the wire
      // and keeps remote players from free-falling over a one-block step the
      // way the local player used to.
      //
      // CACHED. This walks the collision grid, and running it per player per
      // frame is a cost that scales with the player count — the target here is
      // 20-200 of them. A drop only has to be right to within a fraction of a
      // second for an animation choice.
      dropToGround: p.grounded !== false ? 0 : cachedDrop(p),
    };
  }, [cachedDrop]);

  const namePos = useMemo<[number, number, number]>(() => [0, NAME_HEIGHT, 0], []);

  return (
    <group>
      <CharacterAvatar
        character={player.character ?? 'Ash'}
        getInput={getInput}
        getPosition={getPosition}
        getYaw={getYaw}
        armed={!!player.gun}
        // Their user id is the actor key, so the one-shot actions their client
        // broadcasts play on THIS body and not on anyone else's.
        actor={player.userId}
      />
      <NamePlate player={player} offset={namePos} />
    </group>
  );
}

/** The name floats above the player and tracks them each frame. */
function NamePlate({ player, offset }: { player: PlayerState; offset: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const sample = useRef<SampledTransform>({ x: 0, y: 0, z: 0, yaw: 0, speed: 0 });
  const latest = useRef(player);
  latest.current = player;

  React.useEffect(() => {
    return frameLoop.register(`nameplate-${latest.current.userId}`, () => {
      const g = ref.current;
      if (!g) return;
      const p = latest.current;
      const ok = remotePlayerBuffer.sample(p.userId, performance.now(), sample.current);
      const s = sample.current;
      const x = ok ? s.x : p.position.x;
      const y = ok ? s.y : p.position.y;
      const z = ok ? s.z : p.position.z;
      g.position.set(x + offset[0], y - EYE_HEIGHT + offset[1], z + offset[2]);
    }, 60);   // low priority: a name a frame late is invisible
  }, [offset]);

  return (
    <group ref={ref}>
      <Text fontSize={0.28} color="white" anchorX="center" anchorY="middle"
            outlineWidth={0.02} outlineColor="black">
        {player.username || 'Player'}
      </Text>
    </group>
  );
}

export function MultiplayerPlayers({ players }: MultiplayerPlayersProps) {
  if (players.size === 0) return null;
  return (
    <>
      {Array.from(players.values()).map((p) => (
        // Per-player Suspense: a joining player loads their character model,
        // and without a boundary that load would blank the Canvas for everyone
        // already in the world. One boundary EACH, so one slow model cannot
        // hold up the rest.
        <Suspense key={p.userId} fallback={null}>
          <OtherPlayer player={p} />
        </Suspense>
      ))}
    </>
  );
}
