/**
 * useFlamethrower - Reusable flamethrower module for the Flame Glove and any future flamethrower weapons.
 *
 * Loads /flamethrower.json via three.quarks, manages continuous flame stream,
 * cooldown, sound, and provides cone-based enemy hit detection.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { QuarksLoader, BatchedParticleRenderer, ParticleSystem, ParticleEmitter } from 'three.quarks';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';

// Flame Glove constants
const MAX_USE_DURATION = 10; // seconds
const COOLDOWN_DURATION = 3; // seconds
const FLAME_CONE_HALF_ANGLE = Math.PI / 9; // ~20 degrees half-angle — matches visual flame spread
const DAMAGE_TICK_INTERVAL = 0.1; // apply damage every 100ms

export interface FlamethrowerConfig {
  color1: string;       // hex color: bright/inner (glow + early gradient)
  color2: string;       // hex color: mid flame
  color3: string;       // hex color: dark/outer (late gradient)
  fireOpacity: number;  // overall fire alpha 0-1
  smokeOpacity: number; // smoke emitter alpha 0-1
  distance: number;     // meters
  tier: number;         // for damage calculation (10 DPS per tier)
  width?: number;       // emitter cone radius scale (default 1.0)
  speed?: number;       // particle start speed (default 21.6)
  particles?: number;   // emission rate (default 80)
  transparency?: number; // particle alpha 0-1 (default 1.0)
}

export interface FlamethrowerHandle {
  startFlame: () => void;
  stopFlame: () => void;
  isActive: boolean;
  canFire: boolean;
  cooldownRemaining: number;
  /** Call each frame from the frame loop to get enemies in the flame cone */
  getEnemiesInCone: (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
    enemies: Array<{ position: THREE.Vector3; id: string }>
  ) => string[];
}

// Temp vectors to avoid allocations
const _tempDir = new THREE.Vector3();
const _tempEnemyDir = new THREE.Vector3();
// 180° rotation around Y to flip particles from +Z (cone emitter default) to -Z (camera look direction)
const _flipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
// Offset so flame originates from the left side of view (flame glove hand position)
const _localOffset = new THREE.Vector3(-0.35, -0.15, -0.3);
const _worldOffset = new THREE.Vector3();

export function useFlamethrower(config: FlamethrowerConfig) {
  const { scene, camera } = useThree();

  // Refs for state
  const isActiveRef = useRef(false);
  const canFireRef = useRef(true);
  const useTimeRef = useRef(0);
  const cooldownRemainingRef = useRef(0);
  const lastDamageTickRef = useRef(0);

  // three.quarks refs
  const batchRendererRef = useRef<BatchedParticleRenderer | null>(null);
  const loadedGroupRef = useRef<THREE.Object3D | null>(null);
  const emittersRef = useRef<ParticleEmitter[]>([]);
  const loadedRef = useRef(false);
  const fadingOutRef = useRef(false); // true while particles are fading after button release
  const [loadedFlag, setLoadedFlag] = useState(false); // state mirror so useEffects re-trigger
  const loadingRef = useRef(false);

  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Original alpha key values per emitter (to prevent destructive compounding in applyColors)
  const originalAlphasRef = useRef<Map<ParticleEmitter, number[]>>(new Map());

  // Config refs (update without re-creating)
  const configRef = useRef(config);
  configRef.current = config;

  // Preload audio
  useEffect(() => {
    const audio = new Audio('/flame_glove.mp3');
    audio.loop = true;
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Load flamethrower.json and set up three.quarks
  useEffect(() => {
    if (loadedRef.current || loadingRef.current) return;
    loadingRef.current = true;

    let batchRenderer: BatchedParticleRenderer | null = null;

    try {
      // Create batch renderer (single draw call for all quarks particles)
      batchRenderer = new BatchedParticleRenderer();
      scene.add(batchRenderer);
      batchRendererRef.current = batchRenderer;
    } catch (err) {
      console.error('[Flamethrower] Failed to create BatchedParticleRenderer:', err);
      loadingRef.current = false;
      return;
    }

    try {
      const loader = new QuarksLoader();
      loader.setCrossOrigin('');

      loader.load('/flamethrower.json', (obj: THREE.Object3D) => {
        try {
          // The loaded object is a Group containing emitter groups
          loadedGroupRef.current = obj;

          // Hide initially (not firing)
          obj.visible = false;
          scene.add(obj);

          // Find all particle emitters and register with batch renderer
          const emitters: ParticleEmitter[] = [];
          obj.traverse((child: any) => {
            if (child.type === 'ParticleEmitter') {
              const emitter = child as ParticleEmitter;
              emitters.push(emitter);
              // Register each particle system with the batch renderer
              if (emitter.system && batchRenderer) {
                batchRenderer.addSystem(emitter.system);
              }
            }
          });
          emittersRef.current = emitters;
          loadedRef.current = true;
          setLoadedFlag(true);

          // Pause all emitters initially (only play when firing)
          for (const emitter of emitters) {
            if (emitter.system) {
              emitter.system.pause();
            }
          }

          // Capture original alpha key values before any applyColors call
          for (const emitter of emitters) {
            const ps = emitter.system;
            if (!ps) continue;
            for (const behavior of (ps as any).behaviors || []) {
              if (behavior.type === 'ColorOverLife' && behavior.color?.alpha?.keys) {
                originalAlphasRef.current.set(emitter, behavior.color.alpha.keys.map((k: any) => k.value ?? 1));
              }
            }
          }

          // Apply initial settings from latest config (ref avoids stale closure)
          const cfg = configRef.current;
          applyColors(cfg.color1, cfg.color2, cfg.color3, cfg.fireOpacity, cfg.smokeOpacity);
          const spd = cfg.speed ?? 21.6;
          applySpeed(spd);
          applyDistance(cfg.distance, spd);
          if (cfg.width !== undefined) applyWidth(cfg.width);
          if (cfg.particles !== undefined) applyParticles(cfg.particles);
          if (cfg.transparency !== undefined) applyTransparency(cfg.transparency);

          console.log(`[Flamethrower] Loaded with ${emitters.length} emitters`);
        } catch (innerErr) {
          console.error('[Flamethrower] Error processing loaded scene:', innerErr);
        }
      }, undefined, (err: any) => {
        console.error('[Flamethrower] Failed to load flamethrower.json:', err);
        loadingRef.current = false;
      });
    } catch (err) {
      console.error('[Flamethrower] Failed to create QuarksLoader:', err);
      loadingRef.current = false;
    }

    return () => {
      // Cleanup
      if (loadedGroupRef.current) {
        scene.remove(loadedGroupRef.current);
        loadedGroupRef.current = null;
      }
      if (batchRendererRef.current) {
        scene.remove(batchRendererRef.current);
        batchRendererRef.current = null;
      }
      loadedRef.current = false;
      setLoadedFlag(false);
      loadingRef.current = false;
    };
  }, [scene]);

  // Detect if an emitter is the smoke emitter by name (not blending mode)
  const isSmokeEmitter = useCallback((emitter: ParticleEmitter): boolean => {
    const name = (emitter.name || '').toLowerCase();
    return name.includes('smoke');
  }, []);

  // Apply 3-color gradient to flame particles + smoke opacity
  const applyColors = useCallback((c1: string, c2: string, c3: string, fireOpacity: number, smokeOpacity: number) => {
    if (!loadedRef.current) return;
    const color1 = new THREE.Color(c1);
    const color2 = new THREE.Color(c2);
    const color3 = new THREE.Color(c3);

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      const isSmoke = isSmokeEmitter(emitter);

      // Override startColor (use color1 for fire, leave smoke neutral-ish)
      if ((ps as any).startColor) {
        const sc = (ps as any).startColor;
        if (sc.color) {
          if (!isSmoke) {
            sc.color.r = color1.r;
            sc.color.g = color1.g;
            sc.color.b = color1.b;
            sc.color.a = fireOpacity;
          } else {
            // Smoke: tint with color3 (darkest) and apply smoke opacity
            sc.color.r = color3.r * 0.5 + 0.5;
            sc.color.g = color3.g * 0.5 + 0.5;
            sc.color.b = color3.b * 0.5 + 0.5;
            sc.color.a = smokeOpacity;
          }
        }
      }

      // Override ColorOverLife behavior gradient
      const origAlphas = originalAlphasRef.current.get(emitter);
      for (const behavior of (ps as any).behaviors || []) {
        if (behavior.type === 'ColorOverLife' && behavior.color) {
          const gradient = behavior.color;

          if (!isSmoke) {
            // Fire emitters: map 3 colors across gradient keys by position
            if (gradient.color && gradient.color.keys) {
              const keys = gradient.color.keys;
              for (const key of keys) {
                if (!key.value) continue;
                const t = key.pos ?? 0;
                // Lerp: 0.0 = color1, 0.5 = color2, 1.0 = color3
                let r: number, g: number, b: number;
                if (t <= 0.5) {
                  const f = t * 2; // 0-1 within first half
                  r = color1.r + (color2.r - color1.r) * f;
                  g = color1.g + (color2.g - color1.g) * f;
                  b = color1.b + (color2.b - color1.b) * f;
                } else {
                  const f = (t - 0.5) * 2; // 0-1 within second half
                  r = color2.r + (color3.r - color2.r) * f;
                  g = color2.g + (color3.g - color2.g) * f;
                  b = color2.b + (color3.b - color2.b) * f;
                }
                key.value.r = r;
                key.value.g = g;
                key.value.b = b;
              }
            }
            // Scale fire alpha keys by fireOpacity (from originals to prevent compounding)
            if (gradient.alpha && gradient.alpha.keys) {
              for (let k = 0; k < gradient.alpha.keys.length; k++) {
                const key = gradient.alpha.keys[k];
                if (key.value !== undefined) {
                  const orig = origAlphas?.[k] ?? 1;
                  key.value = Math.min(1, orig) * fireOpacity;
                }
              }
            }
          } else {
            // Smoke emitter: tint with color3 and set smoke alpha
            if (gradient.color && gradient.color.keys) {
              for (const key of gradient.color.keys) {
                if (!key.value) continue;
                // Blend smoke color toward color3
                key.value.r = color3.r * 0.3 + 0.7 * 0.5;
                key.value.g = color3.g * 0.3 + 0.7 * 0.5;
                key.value.b = color3.b * 0.3 + 0.7 * 0.5;
              }
            }
            // Scale smoke alpha keys (from originals to prevent compounding)
            if (gradient.alpha && gradient.alpha.keys) {
              for (let k = 0; k < gradient.alpha.keys.length; k++) {
                const key = gradient.alpha.keys[k];
                if (key.value !== undefined) {
                  const orig = origAlphas?.[k] ?? 1;
                  key.value = Math.min(1, orig) * smokeOpacity;
                }
              }
            }
          }
        }
      }
    }
  }, [isSmokeEmitter]);

  // Scale distance by adjusting particle lifetime (keeping speed)
  // Minimum lifetime of 0.5s ensures particles form a visible stream, not a cloud
  const applyDistance = useCallback((distance: number, speed: number = 21.6) => {
    if (!loadedRef.current) return;
    const newLife = Math.max(0.5, distance / speed);

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      if ((ps as any).startLife) {
        const sl = (ps as any).startLife;
        if (sl.value !== undefined) {
          sl.value = newLife;
        } else if (sl.a !== undefined) {
          sl.a = newLife * 0.8;
          sl.b = newLife * 1.2;
        }
      }
    }
  }, []);

  // Override particle start speed
  const applySpeed = useCallback((speed: number) => {
    if (!loadedRef.current) return;

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      if ((ps as any).startSpeed) {
        const ss = (ps as any).startSpeed;
        if (ss.value !== undefined) {
          ss.value = speed;
        } else if (ss.a !== undefined) {
          // Scale both ends proportionally
          const ratio = speed / 21.6;
          ss.a = ss.a * ratio;
          ss.b = ss.b * ratio;
        }
      }
    }
  }, []);

  // Scale emitter cone radius (width)
  const applyWidth = useCallback((width: number) => {
    if (!loadedRef.current) return;

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      if ((ps as any).emitterShape && (ps as any).emitterShape.radius !== undefined) {
        // Base radius is 0.01, scale by width factor
        (ps as any).emitterShape.radius = 0.01 * width;
      }
    }
  }, []);

  // Override emission rate (particles per second)
  const applyParticles = useCallback((count: number) => {
    if (!loadedRef.current) return;

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      if ((ps as any).emissionOverTime) {
        const eot = (ps as any).emissionOverTime;
        if (eot.value !== undefined) {
          eot.value = count;
        }
      }
    }
  }, []);

  // Set particle transparency (alpha)
  const applyTransparency = useCallback((alpha: number) => {
    if (!loadedRef.current) return;

    for (const emitter of emittersRef.current) {
      const ps = emitter.system;
      if (!ps) continue;

      // Adjust material opacity
      if ((ps as any).rendererEmitterSettings?.material) {
        (ps as any).rendererEmitterSettings.material.opacity = alpha;
      }

      // Adjust startColor alpha
      if ((ps as any).startColor) {
        const sc = (ps as any).startColor;
        if (sc.color && sc.color.a !== undefined) {
          sc.color.a = alpha;
        }
      }
    }
  }, []);

  // Update all settings when config changes
  useEffect(() => {
    if (loadedRef.current) {
      applyColors(config.color1, config.color2, config.color3, config.fireOpacity, config.smokeOpacity);
      const speed = config.speed ?? 21.6;
      applySpeed(speed);
      applyDistance(config.distance, speed);
      if (config.width !== undefined) applyWidth(config.width);
      if (config.particles !== undefined) applyParticles(config.particles);
      if (config.transparency !== undefined) applyTransparency(config.transparency);
    }
  }, [loadedFlag, config.color1, config.color2, config.color3, config.fireOpacity, config.smokeOpacity, config.distance, config.speed, config.width, config.particles, config.transparency, applyColors, applyDistance, applySpeed, applyWidth, applyParticles, applyTransparency]);

  const startFlame = useCallback(() => {
    if (!canFireRef.current || !loadedRef.current) return;
    if (isActiveRef.current) return;

    // Block firing inside Fortress Safe Zone
    if (isPointInFSZ(camera.position.x, camera.position.y, camera.position.z)) return;

    isActiveRef.current = true;
    fadingOutRef.current = false; // cancel any pending fade-out
    useTimeRef.current = 0;
    lastDamageTickRef.current = 0;

    // Show the flame group
    if (loadedGroupRef.current) {
      loadedGroupRef.current.visible = true;
    }

    // Restart and play all emitter systems FIRST — restart() resets properties to JSON defaults
    for (const emitter of emittersRef.current) {
      if (emitter.system) {
        emitter.system.restart();
        emitter.system.play();
      }
    }

    // Apply latest config AFTER restart so colors/transparency override the JSON defaults
    const cfg = configRef.current;
    applyColors(cfg.color1, cfg.color2, cfg.color3, cfg.fireOpacity, cfg.smokeOpacity);
    const spd = cfg.speed ?? 21.6;
    applySpeed(spd);
    applyDistance(cfg.distance, spd);
    if (cfg.width !== undefined) applyWidth(cfg.width);
    if (cfg.particles !== undefined) applyParticles(cfg.particles);
    if (cfg.transparency !== undefined) applyTransparency(cfg.transparency);

    console.log(`[Flamethrower] START — color1: ${cfg.color1}, fireOpacity: ${cfg.fireOpacity}, smokeOpacity: ${cfg.smokeOpacity}, transparency: ${cfg.transparency}, emitters: ${emittersRef.current.length}`);

    // Play sound
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [applyColors, applySpeed, applyDistance, applyWidth, applyParticles, applyTransparency]);

  const stopFlame = useCallback(() => {
    if (!isActiveRef.current) return;

    isActiveRef.current = false;
    fadingOutRef.current = true;

    // Stop all emitters and clear existing particles immediately
    // restart() clears all in-flight particles, then pause() prevents new emission
    for (const emitter of emittersRef.current) {
      if (emitter.system) {
        emitter.system.restart();
        emitter.system.pause();
      }
    }

    // Hide the group immediately since particles are already cleared
    fadingOutRef.current = false;
    if (loadedGroupRef.current) {
      loadedGroupRef.current.visible = false;
    }

    console.log('[Flamethrower] STOP');

    // Stop sound
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // If we used the full 10 seconds, start cooldown
    if (useTimeRef.current >= MAX_USE_DURATION) {
      canFireRef.current = false;
      cooldownRemainingRef.current = COOLDOWN_DURATION;
    }
  }, []);

  // Per-frame update: position the flame at camera, handle cooldown
  useFrame((_, delta) => {
    // Update batch renderer
    if (batchRendererRef.current) {
      batchRendererRef.current.update(delta);
    }

    // Handle cooldown
    if (!canFireRef.current) {
      cooldownRemainingRef.current -= delta;
      if (cooldownRemainingRef.current <= 0) {
        cooldownRemainingRef.current = 0;
        canFireRef.current = true;
      }
    }

    if ((!isActiveRef.current && !fadingOutRef.current) || !loadedGroupRef.current) return;

    // During fade-out, only keep the group positioned — don't track usage time
    if (!isActiveRef.current) return;

    // Track usage time
    useTimeRef.current += delta;
    if (useTimeRef.current >= MAX_USE_DURATION) {
      stopFlame();
      return;
    }

    // Position the flame at camera with left-side offset (flame glove hand)
    // Cone emitter fires along +Z, but camera looks along -Z, so flip 180° around Y
    const group = loadedGroupRef.current;
    _worldOffset.copy(_localOffset).applyQuaternion(camera.quaternion);
    group.position.copy(camera.position).add(_worldOffset);
    group.quaternion.copy(camera.quaternion).multiply(_flipQuat);
  });

  // Cone-based enemy hit detection (call from frame loop)
  const getEnemiesInCone = useCallback((
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
    enemies: Array<{ position: THREE.Vector3; id: string }>
  ): string[] => {
    const hits: string[] = [];
    const dirNorm = _tempDir.copy(direction).normalize();

    for (const enemy of enemies) {
      _tempEnemyDir.copy(enemy.position).sub(origin);
      const dist = _tempEnemyDir.length();
      if (dist > distance || dist < 0.5) continue;

      _tempEnemyDir.normalize();
      const angle = Math.acos(Math.min(1, dirNorm.dot(_tempEnemyDir)));
      if (angle <= FLAME_CONE_HALF_ANGLE) {
        hits.push(enemy.id);
      }
    }

    return hits;
  }, []);

  return {
    startFlame,
    stopFlame,
    get isActive() { return isActiveRef.current; },
    get canFire() { return canFireRef.current; },
    get cooldownRemaining() { return cooldownRemainingRef.current; },
    getEnemiesInCone,
    isActiveRef,
    canFireRef,
    cooldownRemainingRef,
    useTimeRef,
    lastDamageTickRef,
  };
}
