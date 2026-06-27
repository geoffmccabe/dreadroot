// siegeMonsterCatalog — the ONE registry of siege monster types (1-7) plus a <CatalogMonster>
// that renders one. Both the !N# test-spawner AND the Challenge runner spawn through this, so a
// monster's definition lives in a single place. Type 6 is the "bloody skeleton horde": it has no
// fixed CFG entry — each mob is a random per-individual override (Ov) from makeHordeMember().
import { useGLTF } from '@react-three/drei';
import { MonsterEnemy, type SpinConfig } from './MonsterEnemy';
import { GhostMonster } from './GhostMonster';
import { CrawlerMonster } from './CrawlerMonster';
import type { ColorMods } from './challenge/challengeTypes';
import { fireSpray } from './spray/sprayAttackSystem';
import { throwBoulder } from './boulderSystem';
import { useThree } from '@react-three/fiber';
import { ACID_VOMIT, type SprayConfig } from './spray/sprayConfig';
import { getMonsterOverride } from './monsterStats';
import { effectiveComponentStats } from './componentMonsterStats';

export type MType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;
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
  // Admin-tunable min/max ranges (defaults reproduce the original 0.5–3 m / 1.25–3.75 m/s / 10–100 hp).
  const cs = effectiveComponentStats(6);
  const lerp = (a: number, b: number) => a + Math.random() * (b - a);
  const height = lerp(cs.heightMin, cs.heightMax);
  return {
    url: k.url, modelHeight: k.modelHeight, height,
    speed: lerp(cs.speedMin, cs.speedMax),
    health: lerp(cs.healthMin, cs.healthMax) * k.healthMul,   // range × per-variant multiplier
    desat: 1 - (0.1 + Math.random() * 0.9),            // saturation 10–100% → desat 0–0.9
    hueShift: (Math.random() * 2 - 1) * 0.628,         // ±10% of the spectrum (±0.1·2π rad)
    tintRed: 0.125 + Math.random() * 0.225,            // 12.5–35% red tint
    // shamble faster when small, slower when large (clamped so custom ranges stay sane).
    animSpeed: 4 - Math.max(0, Math.min(1, (height - 0.5) / 2.5)) * 2,
  };
}

export const CFG: Partial<Record<MType, {
  url: string; modelHeight: number; height: number; speed: number;
  gait: 'hop' | 'climb'; sizeJitter: number; speedJitter: number; health: number; animSpeed?: number;
  rangedRange?: number; rangedCooldownMs?: number; rangedCooldownMaxMs?: number; spray?: SprayConfig; boulder?: boolean;
  boss?: 'teleporter'; noStun?: boolean; noKnockback?: boolean; bossSpeedFactor?: number; lightning?: boolean;
  bodyFlames?: BodyFlame[]; smokeTrail?: boolean; spin?: SpinConfig;
  meleeContact?: { dmg: [number, number]; kb: [number, number]; cooldownMs?: number };
  attackRange?: number; attackMs?: number; aggro?: number; wanderRadius?: number;
  attackStyle?: 'spin-lunge'; hitSound?: string; missSound?: string; attackSound?: string; roarSound?: string;
  walkSound?: string; hurtSound?: string; lungeOnSwing?: boolean; callSound?: string; annoyedSound?: string;
  bulletTumble?: boolean; deathStyle?: 'deflate' | 'topple';
  clips?: { idle?: string; walk?: string; attack?: string; death?: string; hit?: string };
  zombie?: boolean;   // false = a distinct creature (no horde size/speed/desat jitter)
  enrageOnHit?: boolean;   // once damaged: walk→run + 50% faster
}>> = {
  1: { url: '/siege/monsters/reddemon.glb',          modelHeight: 1.886, height: 1.8,  speed: 3.2, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.30, health: 100, attackRange: 1.2, attackMs: 1200, meleeContact: { dmg: [10, 50], kb: [3, 7], cooldownMs: 1200 }, attackSound: '/demon_attack.mp3', missSound: '/swoosh_miss_low.mp3', roarSound: '/demon_roar_1.mp3', lungeOnSwing: true },
  2: { url: '/siege/monsters/mushroomgruntanim.glb', modelHeight: 2.331, height: 0.66, speed: 2.8, gait: 'hop',   sizeJitter: 0.50, speedJitter: 0.10, health: 100, attackRange: 1.8, attackMs: 1200, meleeContact: { dmg: [3, 17], kb: [1, 5], cooldownMs: 1200 }, attackStyle: 'spin-lunge', hitSound: '/little_slap.mp3', missSound: '/swoosh_miss_high.mp3', bulletTumble: true, deathStyle: 'deflate' },
  3: { url: '/siege/monsters/dfskeleton.glb',        modelHeight: 1.795, height: 6.0,  speed: 10.0, gait: 'climb', sizeJitter: 0.20, speedJitter: 0.10, health: 500, animSpeed: 6, attackRange: 4, attackMs: 2000, meleeContact: { dmg: [15, 45], kb: [2, 6], cooldownMs: 1800 }, walkSound: '/giant_skeleton_walk.mp3', hurtSound: '/skeleton_hit.mp3' },
  4: { url: '/siege/monsters/demonmale.glb',         modelHeight: 2.145, height: 4.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.10, health: 200, animSpeed: 1.8, attackRange: 1.5, rangedRange: 30, rangedCooldownMs: 2000, rangedCooldownMaxMs: 4000, spray: ACID_VOMIT, callSound: '/deer_roar.mp3', annoyedSound: '/deer_grunt_annoyed.mp3' },
  5: { url: '/siege/monsters/darklord.glb',          modelHeight: 1.843, height: 6.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.0,  speedJitter: 0.0,  health: 500, animSpeed: 1.0, boss: 'teleporter', noStun: true, bossSpeedFactor: 0.4, lightning: true,
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

  // ── FantasyRivals set (10-17). Shared BASIC melee fighting style: walk in, SWIPE attack
  //    (committed swing → strike), heel-pivot backward topple death. Once shot they ENRAGE
  //    (walk→run clip + 50% faster). Clean re-baked walk/run; modelHeight 2.0 (scale = height/2).
  //    Per-monster behaviors/effects/AI come next. ──
  10: { url: '/siege/monsters/slayer.glb',          modelHeight: 2.0, height: 2.0,  speed: 3.0, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 100, animSpeed: 1.0,  zombie: false, enrageOnHit: true, attackRange: 1.8, attackMs: 1200, meleeContact: { dmg: [6, 14],  kb: [2, 5],  cooldownMs: 1200 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  11: { url: '/siege/monsters/pigbutcher.glb',      modelHeight: 2.0, height: 2.2,  speed: 2.8, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 110, animSpeed: 1.0,  zombie: false, enrageOnHit: true, attackRange: 1.9, attackMs: 1300, meleeContact: { dmg: [7, 17],  kb: [2, 5],  cooldownMs: 1300 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  12: { url: '/siege/monsters/mutant.glb',          modelHeight: 2.0, height: 2.6,  speed: 3.2, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 130, animSpeed: 1.0,  zombie: false, enrageOnHit: true, attackRange: 2.1, attackMs: 1100, meleeContact: { dmg: [9, 21],  kb: [2, 6],  cooldownMs: 1100 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  13: { url: '/siege/monsters/forestguardian.glb',  modelHeight: 2.0, height: 3.5,  speed: 2.5, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 175, animSpeed: 0.85, zombie: false, enrageOnHit: true, attackRange: 2.6, attackMs: 1500, meleeContact: { dmg: [14, 30], kb: [3, 7],  cooldownMs: 1500 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  14: { url: '/siege/monsters/barbariangiant.glb',  modelHeight: 2.0, height: 6.0,  speed: 2.6, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 300, animSpeed: 0.65, zombie: false, enrageOnHit: true, attackRange: 3.8, attackMs: 1800, meleeContact: { dmg: [22, 48], kb: [4, 9],  cooldownMs: 1800 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  15: { url: '/siege/monsters/elementalgolem.glb',  modelHeight: 2.0, height: 8.0,  speed: 2.2, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 400, animSpeed: 0.55, zombie: false, enrageOnHit: true, attackRange: 4.6, attackMs: 2000, rangedRange: 45, rangedCooldownMs: 5000, rangedCooldownMaxMs: 10000, boulder: true, meleeContact: { dmg: [30, 60], kb: [5, 11], cooldownMs: 2000 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  16: { url: '/siege/monsters/mechanicalgolem.glb', modelHeight: 2.0, height: 10.0, speed: 2.4, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 500, animSpeed: 0.5,  zombie: false, enrageOnHit: true, attackRange: 5.4, attackMs: 2000, meleeContact: { dmg: [38, 72], kb: [6, 12], cooldownMs: 2000 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  17: { url: '/siege/monsters/fortgolem.glb',       modelHeight: 2.0, height: 12.0, speed: 2.0, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 600, animSpeed: 0.45, zombie: false, enrageOnHit: true, attackRange: 6.4, attackMs: 2200, meleeContact: { dmg: [48, 92], kb: [7, 14], cooldownMs: 2200 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { attack: 'swipe' } },
  // DF Demon — the Fantasy Rivals demon seen dancing in the SciFi City. Same FR melee style as 10-17,
  // but its clips are named idle/walk/attack (defaults), so no clip remap except run→walk for enrage.
  19: { url: '/siege/monsters/dfdemon_dance.glb',   modelHeight: 1.9,  height: 2.4, speed: 3.0, gait: 'climb', sizeJitter: 0, speedJitter: 0, health: 120, animSpeed: 1.0, zombie: false, enrageOnHit: true, attackRange: 2.0, attackMs: 1200, meleeContact: { dmg: [8, 18], kb: [2, 5], cooldownMs: 1200 }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3', lungeOnSwing: true, deathStyle: 'topple', clips: { run: 'walk' } },
};

// effectiveCfg — CFG[type] with the admin's saved overrides (the editable base stats) merged on
// top. CatalogMonster + the challenge runner read THIS, so an admin's edits apply to every new
// spawn (and challenges inherit them, since their boss % multipliers ride on top of this base).
export function effectiveCfg(type: MType): (typeof CFG)[MType] {
  const base = CFG[type];
  if (!base) return base;
  const o = getMonsterOverride(type) as Record<string, number | string | boolean | undefined>;
  if (!o || Object.keys(o).length === 0) return base;
  const m: Record<string, unknown> = { ...base };
  const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : undefined);
  for (const k of ['health', 'speed', 'attackRange', 'attackMs', 'sizeJitter', 'speedJitter', 'animSpeed', 'height', 'aggro', 'wanderRadius']) {
    const v = num(k); if (v != null) m[k] = v;
  }
  if (o.gait === 'hop' || o.gait === 'climb') m.gait = o.gait;
  for (const k of ['noStun', 'noKnockback', 'enrageOnHit']) if (typeof o[k] === 'boolean') m[k] = o[k];
  if (base.meleeContact && [num('dmgMin'), num('dmgMax'), num('kbMin'), num('kbMax')].some((v) => v != null)) {
    m.meleeContact = {
      ...base.meleeContact,
      dmg: [num('dmgMin') ?? base.meleeContact.dmg[0], num('dmgMax') ?? base.meleeContact.dmg[1]],
      kb: [num('kbMin') ?? base.meleeContact.kb[0], num('kbMax') ?? base.meleeContact.kb[1]],
    };
  }
  return m as (typeof CFG)[MType];
}

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
  { id: 9, name: 'Ghost',                    baseHeight: 4.0,  baseHealth: 100 },
  { id: 10, name: 'Slayer',                  baseHeight: 2.0,  baseHealth: 100 },
  { id: 11, name: 'Pig Butcher',             baseHeight: 2.2,  baseHealth: 110 },
  { id: 12, name: 'Mutant',                  baseHeight: 2.6,  baseHealth: 130 },
  { id: 13, name: 'Forest Guardian',         baseHeight: 3.5,  baseHealth: 175 },
  { id: 14, name: 'Barbarian Giant',         baseHeight: 6.0,  baseHealth: 300 },
  { id: 15, name: 'Elemental Golem',         baseHeight: 8.0,  baseHealth: 400 },
  { id: 16, name: 'Mechanical Golem',        baseHeight: 10.0, baseHealth: 500 },
  { id: 17, name: 'Fort Golem',              baseHeight: 12.0, baseHealth: 600 },
  { id: 18, name: 'Crawlies',                baseHeight: 0.85, baseHealth: 40 },
  { id: 19, name: 'DF Demon',                baseHeight: 2.4,  baseHealth: 120 },
];

export interface MonsterMods { sizeMul?: number; speedMul?: number; healthMul?: number; damageMul?: number; }

// Every monster type that has a row in the registry (whether CFG-driven or component-driven). Use
// this to validate challenge/spawn data BEFORE it reaches CatalogMonster, so a bad id surfaces as a
// clear message instead of a silently-empty spawn.
const KNOWN_TYPES = new Set<number>(MONSTER_CATALOG.map((c) => c.id));
export const isKnownMonsterType = (type: number): type is MType => KNOWN_TYPES.has(type);

// One warning per unknown/unspawnable type (not per frame) so misconfigured challenge data is
// visible in the console without spamming it.
const _warnedTypes = new Set<number>();
function warnUnspawnable(type: number): void {
  if (_warnedTypes.has(type)) return;
  _warnedTypes.add(type);
  console.warn(
    `[siege] CatalogMonster: nothing to spawn for monster type ${type} — skipped. ` +
    (KNOWN_TYPES.has(type)
      ? 'Type is in the catalog but has no CFG/override (e.g. horde type spawned without its override).'
      : 'Type is not in MONSTER_CATALOG (bad challenge/spawn data?).'),
  );
}

/** Render one monster of a catalog type at a spawn position. ov = a horde-member override
 *  (type 6); mods = boss size/speed/health multipliers; riseFromGround = rise out of the floor. */
export function CatalogMonster({ type, spawn, id, onDespawn, ov, mods, color, ballColor, riseFromGround }: {
  type: MType; spawn: [number, number, number]; id?: string;
  onDespawn?: (id: string) => void; ov?: Ov; mods?: MonsterMods; color?: ColorMods; ballColor?: string; riseFromGround?: boolean;
}) {
  // The live player camera — the golem must throw at where the player IS NOW, not a stale module value.
  const camera = useThree((s) => s.camera);
  // Type 9 = the Ghost — its own self-contained flying/upside-down/transparent component (not CFG-driven).
  if (type === 9) return <GhostMonster spawn={spawn} id={id} onDespawn={onDespawn} mods={mods} />;
  // Type 18 = the Crawler — self-contained surface-crawl locomotion (walls + undersides), not CFG-driven.
  if (type === 18) return <CrawlerMonster spawn={spawn} id={id} onDespawn={onDespawn} mods={mods} color={color} />;
  const m = effectiveCfg(type);   // CFG + admin base-stat overrides
  const o = ov;
  if (!m && !o) { warnUnspawnable(type); return null; }
  const sz = mods?.sizeMul ?? 1, sp = mods?.speedMul ?? 1, hp = mods?.healthMul ?? 1;
  // Clean display name (no "(boss)"/"(horde)") for the "Killed by a …" death screen.
  const monsterName = (MONSTER_CATALOG.find((x) => x.id === type)?.name ?? '').replace(/\s*\(.*\)\s*/, '').trim();
  return (
    <MonsterEnemy id={id} spawn={spawn} url={o?.url ?? m!.url} name={monsterName} riseFromGround={riseFromGround} damageMul={mods?.damageMul}
      modelHeight={o?.modelHeight ?? m!.modelHeight} height={(o?.height ?? m!.height) * sz} aggro={m?.aggro ?? 400}
      speed={(o?.speed ?? m!.speed) * sp} wanderRadius={m?.wanderRadius ?? 6} health={(o?.health ?? m!.health) * hp}
      animSpeed={o?.animSpeed ?? m?.animSpeed} onDespawn={onDespawn} zombie={o ? true : (m?.zombie ?? true)} gait={m?.gait ?? 'climb'}
      clips={m?.clips}
      sizeJitter={o ? 0 : m!.sizeJitter} speedJitter={o ? 0 : m!.speedJitter}
      desat={o?.desat} hueShift={o?.hueShift} tintRed={o?.tintRed} colorMods={color}
      moanSounds={o ? HORDE6_MOANS : undefined}
      contactDamage={o ? 20 : undefined} kbInverseSize={!!o} stackSink={o ? 0.30 : undefined}
      rangedRange={m?.rangedRange} rangedCooldownMs={m?.rangedCooldownMs} rangedCooldownMaxMs={m?.rangedCooldownMaxMs}
      boss={m?.boss} lightning={m?.lightning} noStun={o ? true : m?.noStun} noKnockback={m?.noKnockback} bossSpeedFactor={m?.bossSpeedFactor}
      bodyFlames={m?.bodyFlames} smokeTrail={m?.smokeTrail} spin={m?.spin}
      meleeContact={o ? { dmg: [4, 12], kb: [1, 2], cooldownMs: 1300 } : m?.meleeContact}
      attackRange={o ? 1.6 : m?.attackRange} attackMs={m?.attackMs}
      attackStyle={m?.attackStyle} hitSound={m?.hitSound} missSound={m?.missSound} attackSound={m?.attackSound} roarSound={m?.roarSound} lungeOnSwing={m?.lungeOnSwing}
      walkSound={m?.walkSound} hurtSound={m?.hurtSound}
      callSound={m?.callSound} annoyedSound={m?.annoyedSound}
      bulletTumble={m?.bulletTumble} deathStyle={m?.deathStyle} enrageOnHit={m?.enrageOnHit}
      onRangedAttack={
        m?.spray ? (x, y, z, dx, dy, dz, wide) => fireSpray(x, y, z, dx, dy, dz, { ...m!.spray!, owner: monsterName, ...(wide ? { coneDeg: 90 } : {}) })
        : m?.boulder ? (x, y, z) => throwBoulder(x, y, z, camera.position.x, camera.position.y - 1.6, camera.position.z, 28 + Math.random() * 26, { color: ballColor })
        : undefined} />
  );
}

// Preload every monster glb at module load (siege entry) so a challenge wave never decodes/suspends on
// the frame it spawns — that synchronous glb decode was a chunk of the Death Dark City start-up freeze.
{
  const urls = new Set<string>();
  for (const k in CFG) { const u = (CFG as Record<string, { url?: string }>)[k]?.url; if (u) urls.add(u); }
  for (const h of HORDE6) urls.add(h.url);
  urls.forEach((u) => useGLTF.preload(u));
}
