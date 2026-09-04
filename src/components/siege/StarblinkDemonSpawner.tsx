// StarblinkDemonSpawner — ambient red demons roaming the Starblink land world.
//
// Rules (Geoff, 2026-Sep-04):
//   • Every minute there is a 50% chance one spawns, somewhere within 100 m of the player.
//   • Tiers are the SWU red demon at 2 m, 4 m, 6 m, 8 m, 10 m … each a different colour.
//   • Each tier is HALF as likely as the one below it: 50%, 25%, 12.5%, 6.25%, …
//   • Each tier is 5% faster than the one below it.
//   • Each tier has 2x the health of the one below it.
//
// Everything else (aggro, melee, sounds, animation, ground-follow) is stock MonsterEnemy, so this
// file stays a spawn POLICY and does not fork monster behaviour.

import { useEffect, useRef, useState, Suspense } from 'react';
import { useThree } from '@react-three/fiber';
import { MonsterEnemy } from './MonsterEnemy';
import { sampleHeight } from './terrainHeight';

const CHECK_EVERY_MS = 60_000;   // one roll per minute
const SPAWN_CHANCE = 0.5;        // …which succeeds half the time
const TIER_STEP_CHANCE = 0.5;    // each tier up is half as likely as the one below
const MAX_ALIVE = 12;            // framerate guard; the roll is skipped while at the cap

const NEAR_M = 30;               // never drop one in the player's lap
const FAR_M = 100;               // "within 100 m of the player"

/** Tier 0 is the 2 m demon; every step up is +2 m, x2 health, x1.05 speed. */
const BASE_HEIGHT_M = 2;
const BASE_HEALTH = 500;         // so the 4 m tier lands on 1000, matching SWU's existing red demon
const BASE_SPEED = 2.5;          // MonsterEnemy's default walk speed
const SPEED_PER_TIER = 1.05;
const HEALTH_PER_TIER = 2;

/** Per-tier hue rotation (radians) off the red source model, plus a name for the death screen. */
const TIERS = [
  { name: 'Red Demon',    hueShift: 0 },
  { name: 'Amber Demon',  hueShift: 1.05 },
  { name: 'Jade Demon',   hueShift: 2.09 },
  { name: 'Azure Demon',  hueShift: 3.14 },
  { name: 'Violet Demon', hueShift: 4.19 },
];

const MODEL_URL = '/siege/monsters/reddemon.glb';
const MODEL_HEIGHT_M = 1.886;    // intrinsic glb height, from the converter

interface Demon {
  id: string;
  tier: number;
  pos: [number, number, number];
}

/**
 * Which tier spawns. Tier 0 half the time, then each step up halves again, exactly as specified.
 * The top tier absorbs the leftover tail so the odds still add to one.
 */
function rollTier(): number {
  let tier = 0;
  while (tier < TIERS.length - 1 && Math.random() < TIER_STEP_CHANCE) tier++;
  return tier;
}

/** A random spot on the ring NEAR_M..FAR_M around (x, z), sitting on the ground. */
function rollPosition(x: number, z: number): [number, number, number] {
  const angle = Math.random() * Math.PI * 2;
  // sqrt keeps the points evenly spread over the ring's AREA rather than bunched at the centre.
  const t = Math.sqrt(Math.random());
  const dist = NEAR_M + t * (FAR_M - NEAR_M);
  const sx = x + Math.cos(angle) * dist;
  const sz = z + Math.sin(angle) * dist;
  return [sx, sampleHeight(sx, sz) ?? 0, sz];
}

export function StarblinkDemonSpawner() {
  const { camera } = useThree();
  const [demons, setDemons] = useState<Demon[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const tick = () => {
      if (Math.random() >= SPAWN_CHANCE) return;
      setDemons((cur) => {
        if (cur.length >= MAX_ALIVE) return cur;
        const tier = rollTier();
        const pos = rollPosition(camera.position.x, camera.position.z);
        const id = `sb-demon-${nextId.current++}`;
        return [...cur, { id, tier, pos }];
      });
    };
    const timer = window.setInterval(tick, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [camera]);

  const despawn = (id: string) => setDemons((cur) => cur.filter((d) => d.id !== id));

  return (
    <Suspense fallback={null}>
      {demons.map((d) => {
        const t = TIERS[d.tier];
        return (
          <MonsterEnemy
            key={d.id}
            id={d.id}
            spawn={d.pos}
            url={MODEL_URL}
            name={t.name}
            modelHeight={MODEL_HEIGHT_M}
            height={BASE_HEIGHT_M * (d.tier + 1)}
            health={BASE_HEALTH * Math.pow(HEALTH_PER_TIER, d.tier)}
            speed={BASE_SPEED * Math.pow(SPEED_PER_TIER, d.tier)}
            hueShift={t.hueShift}
            aggro={140}
            noStun
            attackRange={2.2}
            attackMs={1500}
            meleeContact={{ dmg: [20, 60], kb: [4, 9], cooldownMs: 1500 }}
            roarSound="/demon_roar_1.mp3"
            attackSound="/demon_attack.mp3"
            missSound="/swoosh_miss_low.mp3"
            onDespawn={despawn}
          />
        );
      })}
    </Suspense>
  );
}
