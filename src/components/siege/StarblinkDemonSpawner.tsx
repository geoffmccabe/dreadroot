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
import { worldStore } from '@/services/worldStore';

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
const KNOCKBACK_PER_TIER = 1.5;  // 100%, 150%, 225%, 337%, 506%
const DAMAGE_PER_TIER = 1.1;     // +10% per tier
const BASE_MELEE_DMG: [number, number] = [20, 60];
const BASE_MELEE_KB: [number, number] = [4, 9];

/**
 * Per-tier appearance, as hue rotation (radians) off the RED source model plus optional
 * desaturation, and a name used by the death screen and the KILLS panel.
 *
 * Tier 1 is deliberately the drab one and tier 5 the original red, so the rarest demon is the one
 * that looks like the real thing. Tier 1 gets a nudge towards orange and then most of its colour
 * pulled out, which reads as brown/tan rather than flat grey.
 */
const TIERS = [
  { name: 'Ash Demon',     hueShift: 0.45, desat: 0.72, rarity: 'common' },
  { name: 'Jade Demon',    hueShift: 2.09, desat: 0,    rarity: 'uncommon' },
  { name: 'Azure Demon',   hueShift: 4.19, desat: 0,    rarity: 'rare' },
  { name: 'Violet Demon',  hueShift: 5.06, desat: 0,    rarity: 'epic' },
  { name: 'Crimson Demon', hueShift: 0,    desat: 0,    rarity: 'legendary' },
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

  // A despawn only happens after the death sequence finishes, so it doubles as the kill signal.
  // Tiers are 1-based everywhere the player sees them, hence the +1.
  const despawn = (id: string, tier: number) => {
    setDemons((cur) => cur.filter((d) => d.id !== id));
    void worldStore.recordKill(`reddemon_t${tier + 1}`)
      .catch((e) => console.error('[Starblink] recordKill failed', e));
  };

  return (
    <>
      {demons.map((d) => {
        const t = TIERS[d.tier];
        const kb = Math.pow(KNOCKBACK_PER_TIER, d.tier);
        const dmg = Math.pow(DAMAGE_PER_TIER, d.tier);
        return (
          // ONE Suspense PER DEMON, and that matters. With a single boundary around the whole
          // list, a newly spawning demon suspends its already-running siblings: their mixers stop
          // and they freeze mid-fight in the bind pose (the T-pose Geoff hit). Isolated boundaries
          // mean a new arrival can never interrupt a demon that is already on screen.
          <Suspense key={d.id} fallback={null}>
          <MonsterEnemy
            id={d.id}
            spawn={d.pos}
            url={MODEL_URL}
            name={t.name}
            modelHeight={MODEL_HEIGHT_M}
            height={BASE_HEIGHT_M * (d.tier + 1)}
            health={BASE_HEALTH * Math.pow(HEALTH_PER_TIER, d.tier)}
            speed={BASE_SPEED * Math.pow(SPEED_PER_TIER, d.tier)}
            hueShift={t.hueShift}
            desat={t.desat || undefined}
            aggro={140}
            noStun
            attackRange={2.2}
            attackMs={1500}
            meleeContact={{
              dmg: [BASE_MELEE_DMG[0] * dmg, BASE_MELEE_DMG[1] * dmg],
              kb: [BASE_MELEE_KB[0] * kb, BASE_MELEE_KB[1] * kb],
              cooldownMs: 1500,
            }}
            roarSound="/demon_roar_1.mp3"
            attackSound="/demon_attack.mp3"
            missSound="/swoosh_miss_low.mp3"
            onDespawn={(id) => despawn(id, d.tier)}
          />
          </Suspense>
        );
      })}
    </>
  );
}
