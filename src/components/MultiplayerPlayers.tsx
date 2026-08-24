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
import React, { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text } from '@react-three/drei';
import { remotePlayerBuffer, type SampledTransform } from '@/features/netcode/transformBuffer';
import { CharacterAvatar } from '@/features/characters/animation/CharacterAvatar';
import type { MoveInput } from '@/features/characters/animation/movementState';

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
    return (ok ? sample.current.yaw : p.rotation.yaw) + Math.PI;
  }, []);

  const getInput = useCallback((): MoveInput => {
    const p = latest.current;
    return {
      mf: p.mf ?? 0,
      mr: p.mr ?? 0,
      run: !!p.run,
      grounded: p.grounded !== false,
      vy: p.vy ?? 0,
      gliding: false,   // not on the wire yet — plan phase 3
      boosting: false,
    };
  }, []);

  const namePos = useMemo<[number, number, number]>(() => [0, NAME_HEIGHT, 0], []);

  return (
    <group>
      <CharacterAvatar
        character={player.character ?? 'Ash'}
        getInput={getInput}
        getPosition={getPosition}
        getYaw={getYaw}
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
    let raf = 0;
    const tick = () => {
      const g = ref.current;
      if (g) {
        const p = latest.current;
        const ok = remotePlayerBuffer.sample(p.userId, performance.now(), sample.current);
        const s = sample.current;
        const x = ok ? s.x : p.position.x;
        const y = ok ? s.y : p.position.y;
        const z = ok ? s.z : p.position.z;
        g.position.set(x + offset[0], y - EYE_HEIGHT + offset[1], z + offset[2]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
        <OtherPlayer key={p.userId} player={p} />
      ))}
    </>
  );
}
