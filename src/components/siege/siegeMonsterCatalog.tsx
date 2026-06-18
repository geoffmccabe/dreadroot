// siegeMonsterCatalog — the ONE registry of siege monster types (1-7) plus a <CatalogMonster>
// that renders one. Both the !N# test-spawner AND the Challenge runner spawn through this, so a
// monster's definition lives in a single place. Type 6 is the "bloody skeleton horde": it has no
// fixed CFG entry — each mob is a random per-individual override (Ov) from makeHordeMember().
import { MonsterEnemy, type SpinConfig } from './MonsterEnemy';
import { fireSpray } from './spray/sprayAttackSystem';
import { ACID_VOMIT, type SprayConfig } from './spray/sprayConfig';

export type MType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BodyFlame = { radiusMul: number; heightMul: number; colorHot: string; colorCool: string };
export type Ov = { url: string; modelHeight: number; height: number; speed: number; health: number;
                   desat: number; hueShift: number; tintRed: number; animSpeed: number };

// Type-6 horde: a random mix of three skeletons (ranger/heavy get more HP). The SW zombie moans.
export const HORDE6 = [
  { url: '/siege/monsters/skeletonheavy.glb',  modelHeight: 1.795, healthMul: 2 },
  { url: '/siege/monsters/skeletonlight.glb',  modelHeight: 1.795, healthMul: 1 },
  { url: '/siege/monsters/skeletonranger.glb', modelHeight: 1.797, healthMul: 3 },
];
export const HORDE6_MOANS = ['/monster-sounds/zombie_moan_3p1.mp3', '/monster-sounds/zombie_moan_3p2.mp3', '/monster-sounds/zombie_moan_6p1.mp3'];
export function makeHordeMember(): Ov {
  const k = HORDE6[(Math.random() * HORDE6.length) | 0];
  const height = 0.5 + Math.random() * 2.5;            // 0.5–3 m (wide range)
  return {
    url: k.url, modelHeight: k.modelHeight, height,
    speed: 2.5 * (0.5 + Math.random()),                // ±50% (0.5×–1.5× of 2.5)
    health: (10 + Math.random() * 90) * k.healthMul,   // 10–100 × type multiplier
    desat: 1 - (0.1 + Math.random() * 0.9),            // saturation 10–100% → desat 0–0.9
    hueShift: (Math.random() * 2 - 1) * 0.628,         // ±10% of the spectrum (±0.1·2π rad)
    tintRed: 0.125 + Math.random() * 0.225,            // 12.5–35% red tint
    animSpeed: 4 - ((height - 0.5) / 2.5) * 2,          // shamble 4× at 0.5m → 2× at 3m
  };
}

export const CFG: Partial<Record<MType, {
  url: string; modelHeight: number; height: number; speed: number;
  gait: 'hop' | 'climb'; sizeJitter: number; speedJitter: number; health: number; animSpeed?: number;
  rangedRange?: number; rangedCooldownMs?: number; rangedCooldownMaxMs?: number; spray?: SprayConfig;
  boss?: 'teleporter'; noStun?: boolean; noKnockback?: boolean; bossSpeedFactor?: number;
  bodyFlames?: BodyFlame[]; smokeTrail?: boolean; spin?: SpinConfig;
  meleeContact?: { dmg: [number, number]; kb: [number, number]; cooldownMs?: number };
  attackRange?: number; attackMs?: number;
  attackStyle?: 'spin-lunge'; hitSound?: string; missSound?: string; attackSound?: string; roarSound?: string;
  walkSound?: string; hurtSound?: string; lungeOnSwing?: boolean; callSound?: string; annoyedSound?: string;
}>> = {
  1: { url: '/siege/monsters/reddemon.glb',          modelHeight: 1.886, height: 1.8,  speed: 3.2, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.30, health: 100, attackRange: 1.2, attackMs: 1200, meleeContact: { dmg: [10, 50], kb: [3, 7], cooldownMs: 1200 }, attackSound: '/demon_attack.mp3', missSound: '/swoosh_miss_low.mp3', roarSound: '/demon_roar_1.mp3', lungeOnSwing: true },
  2: { url: '/siege/monsters/mushroomgruntanim.glb', modelHeight: 2.331, height: 0.66, speed: 2.8, gait: 'hop',   sizeJitter: 0.50, speedJitter: 0.10, health: 100, attackRange: 1.8, attackMs: 1200, meleeContact: { dmg: [3, 17], kb: [1, 5], cooldownMs: 1200 }, attackStyle: 'spin-lunge', hitSound: '/little_slap.mp3', missSound: '/swoosh_miss_high.mp3' },
  3: { url: '/siege/monsters/dfskeleton.glb',        modelHeight: 1.795, height: 6.0,  speed: 10.0, gait: 'climb', sizeJitter: 0.20, speedJitter: 0.10, health: 500, animSpeed: 6, attackRange: 4, attackMs: 2000, meleeContact: { dmg: [15, 45], kb: [2, 6], cooldownMs: 1800 }, walkSound: '/giant_skeleton_walk.mp3', hurtSound: '/skeleton_hit.mp3' },
  4: { url: '/siege/monsters/demonmale.glb',         modelHeight: 2.145, height: 4.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.10, health: 200, animSpeed: 1.8, attackRange: 1.5, rangedRange: 30, rangedCooldownMs: 2000, rangedCooldownMaxMs: 4000, spray: ACID_VOMIT, callSound: '/deer_roar.mp3', annoyedSound: '/deer_grunt_annoyed.mp3' },
  5: { url: '/siege/monsters/darklord.glb',          modelHeight: 1.843, height: 6.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.0,  speedJitter: 0.0,  health: 500, animSpeed: 1.0, boss: 'teleporter', noStun: true, bossSpeedFactor: 0.4,
       bodyFlames: [{ radiusMul: 1.05, heightMul: 2.0, colorHot: '#b85cff', colorCool: '#1a0033' }] },
  7: { url: '/siege/monsters/greentroll.glb',        modelHeight: 1.927, height: 3.0,  speed: 3.5, gait: 'hop',   sizeJitter: 0.10, speedJitter: 0.15, health: 200, animSpeed: 1.0,
       smokeTrail: true, noStun: true,
       bodyFlames: [
         { radiusMul: 1.05, heightMul: 1.70, colorHot: '#5cff6a', colorCool: '#06330f' },
         { radiusMul: 0.525, heightMul: 2.72, colorHot: '#5cc0ff', colorCool: '#031a40' },
       ],
       spin: { revPerSec: [3, 5], zoomEveryMs: [1000, 10000], zoomSpeedMul: [3, 10], contactDmg: [10, 100], contactKb: [1, 10], zoomHitMul: 2, playerSpinRev: [0.5, 2], spinSound: '/spintroll_sound.mp3' } },
  // The BIG original red demon — its own monster, separate from the small Demon Horde (#1). Same
  // model + sounds for now, but independently tunable (HP/damage/AI/sounds).
  8: { url: '/siege/monsters/reddemon.glb',          modelHeight: 1.886, height: 4.0,  speed: 3.2, gait: 'climb', sizeJitter: 0.05, speedJitter: 0.10, health: 1000, noStun: true, attackRange: 2.2, attackMs: 1500, meleeContact: { dmg: [20, 60], kb: [4, 9], cooldownMs: 1500 }, attackSound: '/demon_attack.mp3', missSound: '/swoosh_miss_low.mp3', roarSound: '/demon_roar_1.mp3' },
};

// Display registry (creator dropdowns + boss original→new readouts). baseHeight = normal height.
export const MONSTER_CATALOG: { id: MType; name: string; baseHeight: number; baseHealth: number }[] = [
  { id: 1, name: 'Demon Horde',              baseHeight: 1.8,  baseHealth: 100 },
  { id: 2, name: 'Mushroom Grunt',           baseHeight: 0.66, baseHealth: 100 },
  { id: 3, name: 'Giant Skeleton',           baseHeight: 6.0,  baseHealth: 500 },
  { id: 4, name: 'Vomit Demon',              baseHeight: 4.0,  baseHealth: 200 },
  { id: 5, name: 'Dark Lord (boss)',         baseHeight: 6.0,  baseHealth: 500 },
  { id: 6, name: 'Bloody Skeleton (horde)',  baseHeight: 1.8,  baseHealth: 50 },
  { id: 7, name: 'Spintroll',                baseHeight: 3.0,  baseHealth: 200 },
  { id: 8, name: 'Red Demon',                baseHeight: 4.0,  baseHealth: 1000 },
];

export interface MonsterMods { sizeMul?: number; speedMul?: number; healthMul?: number; damageMul?: number; }

/** Render one monster of a catalog type at a spawn position. ov = a horde-member override
 *  (type 6); mods = boss size/speed/health multipliers; riseFromGround = rise out of the floor. */
export function CatalogMonster({ type, spawn, id, onDespawn, ov, mods, riseFromGround }: {
  type: MType; spawn: [number, number, number]; id?: string;
  onDespawn?: (id: string) => void; ov?: Ov; mods?: MonsterMods; riseFromGround?: boolean;
}) {
  const m = CFG[type];
  const o = ov;
  if (!m && !o) return null;
  const sz = mods?.sizeMul ?? 1, sp = mods?.speedMul ?? 1, hp = mods?.healthMul ?? 1;
  return (
    <MonsterEnemy id={id} spawn={spawn} url={o?.url ?? m!.url} riseFromGround={riseFromGround} damageMul={mods?.damageMul}
      modelHeight={o?.modelHeight ?? m!.modelHeight} height={(o?.height ?? m!.height) * sz} aggro={400}
      speed={(o?.speed ?? m!.speed) * sp} wanderRadius={6} health={(o?.health ?? m!.health) * hp}
      animSpeed={o?.animSpeed ?? m?.animSpeed} onDespawn={onDespawn} zombie gait={m?.gait ?? 'climb'}
      sizeJitter={o ? 0 : m!.sizeJitter} speedJitter={o ? 0 : m!.speedJitter}
      desat={o?.desat} hueShift={o?.hueShift} tintRed={o?.tintRed}
      moanSounds={o ? HORDE6_MOANS : undefined}
      contactDamage={o ? 20 : undefined} kbInverseSize={!!o} stackSink={o ? 0.30 : undefined}
      rangedRange={m?.rangedRange} rangedCooldownMs={m?.rangedCooldownMs} rangedCooldownMaxMs={m?.rangedCooldownMaxMs}
      boss={m?.boss} noStun={o ? true : m?.noStun} noKnockback={m?.noKnockback} bossSpeedFactor={m?.bossSpeedFactor}
      bodyFlames={m?.bodyFlames} smokeTrail={m?.smokeTrail} spin={m?.spin}
      meleeContact={o ? { dmg: [4, 12], kb: [1, 2], cooldownMs: 1300 } : m?.meleeContact}
      attackRange={o ? 1.6 : m?.attackRange} attackMs={m?.attackMs}
      attackStyle={m?.attackStyle} hitSound={m?.hitSound} missSound={m?.missSound} attackSound={m?.attackSound} roarSound={m?.roarSound} lungeOnSwing={m?.lungeOnSwing}
      walkSound={m?.walkSound} hurtSound={m?.hurtSound}
      callSound={m?.callSound} annoyedSound={m?.annoyedSound}
      onRangedAttack={m?.spray ? (x, y, z, dx, dy, dz, wide) => fireSpray(x, y, z, dx, dy, dz, wide ? { ...m!.spray!, coneDeg: 90 } : m!.spray!) : undefined} />
  );
}
