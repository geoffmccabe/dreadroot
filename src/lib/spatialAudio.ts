// Spatial Audio System with distance-based falloff
// Uses Web Audio API for overlapping sounds

import * as THREE from 'three';
import { getAudioBlob, saveAudioBlob, deleteAudioBlob } from '@/lib/audioCache';
import './audioPreload'; // self-schedules an idle warm of all game sounds into IndexedDB

let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const loadingPromises = new Map<string, Promise<AudioBuffer>>();

// Audio distance parameters
const MAX_AUDIO_DISTANCE = 50; // Beyond this, sounds are silent
const REFERENCE_DISTANCE = 5;  // Distance at which sound is at full volume
const ROLLOFF_FACTOR = 1.5;    // How quickly sound fades with distance

// Yodel/long-range audio parameters
const YODEL_MAX_DISTANCE = 500;    // Yodels carry across the entire map
const YODEL_REFERENCE_DISTANCE = 20; // Full volume within 20 blocks
const YODEL_ROLLOFF_FACTOR = 0.5;   // Much slower falloff than normal sounds

function getAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
      return null;
    }
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
}

async function loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
  // Check cache
  if (bufferCache.has(url)) {
    return bufferCache.get(url)!;
  }
  
  // Check if already loading
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url)!;
  }
  
  const ctx = getAudioContext();
  if (!ctx) return null;
  
  const promise = (async () => {
    try {
      // Tier 2: IndexedDB — use the persisted blob if we have it, else fetch
      // once and persist for next session. decodeAudioData detaches the
      // ArrayBuffer, so we always decode from a fresh blob.arrayBuffer().
      let blob = await getAudioBlob(url);
      const fromCache = !!blob;
      if (!blob) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        blob = await response.blob();
        void saveAudioBlob(url, blob); // fire-and-forget persist
      }
      const arrayBuffer = await blob.arrayBuffer();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        bufferCache.set(url, audioBuffer);
        return audioBuffer;
      } catch (decodeErr) {
        // A cached blob that won't decode is poisoned — drop it so the next
        // attempt re-fetches from the network instead of failing forever.
        if (fromCache) void deleteAudioBlob(url);
        throw decodeErr;
      }
    } catch (error) {
      console.warn(`Failed to load audio: ${url}`, error);
      throw error;
    } finally {
      // Clear the in-flight entry so a failed load can be retried later
      // (and the map doesn't grow unbounded).
      loadingPromises.delete(url);
    }
  })();

  loadingPromises.set(url, promise);
  return promise;
}

/**
 * Calculate volume based on distance (inverse-distance falloff)
 */
function calculateVolumeFromDistance(distance: number): number {
  if (distance >= MAX_AUDIO_DISTANCE) return 0;
  if (distance <= REFERENCE_DISTANCE) return 1;
  
  // Inverse distance falloff
  const volume = REFERENCE_DISTANCE / (REFERENCE_DISTANCE + ROLLOFF_FACTOR * (distance - REFERENCE_DISTANCE));
  return Math.max(0, Math.min(1, volume));
}

/**
 * Play a sound with distance-based volume falloff
 * Returns immediately - sound plays asynchronously and can overlap
 */
export async function playSpatialSound(
  url: string,
  distance: number,
  options: {
    baseVolume?: number;
    playbackRate?: number;
    detune?: number;
    /** If > 0, ramp playback rate (pitch + speed) down toward 0 and fade the
     *  gain out over this many ms, then stop — an "powering down" effect. */
    pitchDownMs?: number;
    /** If > 0 (with pitchDownMs), hard-gate the gain on/off every this-many ms
     *  during the ramp — a glitchy/stuttering power-down instead of a smooth
     *  fade. */
    stutterMs?: number;
    /** Play only a SEGMENT of the file: start `clipStart` seconds in, for
     *  `clipDur` seconds (e.g. a 0.1s snippet from the middle of a long sound). */
    clipStart?: number;
    clipDur?: number;
  } = {}
): Promise<void> {
  const { baseVolume = 0.5, playbackRate = 1.0, detune = 0, pitchDownMs = 0, stutterMs = 0, clipStart = 0, clipDur = 0 } = options;

  const volume = calculateVolumeFromDistance(distance) * baseVolume;
  if (volume <= 0.01) return; // Too quiet to hear

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const buffer = await loadAudioBuffer(url);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    if (detune !== 0) {
      source.detune.value = detune;
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (pitchDownMs > 0) {
      // Powering-down: ramp pitch/speed toward ~0 while fading out, then stop.
      // (playbackRate can't be exactly 0, so ramp to a tiny value.)
      const t0 = ctx.currentTime;
      const t1 = t0 + pitchDownMs / 1000;
      source.playbackRate.setValueAtTime(playbackRate, t0);
      source.playbackRate.linearRampToValueAtTime(0.0001, t1);
      if (stutterMs > 0) {
        // Glitchy power-down: hard-gate the gain on/off every stutterMs while
        // the overall level fades, instead of a smooth fade.
        const step = stutterMs / 1000;
        let on = true;
        for (let t = t0; t < t1; t += step) {
          const frac = (t - t0) / (t1 - t0);
          gainNode.gain.setValueAtTime(on ? volume * (1 - frac) : 0.0001, t);
          on = !on;
        }
        gainNode.gain.setValueAtTime(0.0001, t1);
      } else {
        gainNode.gain.setValueAtTime(volume, t0);
        gainNode.gain.linearRampToValueAtTime(0.0001, t1);
      }
      source.start(0);
      source.stop(t1 + 0.05);
    } else if (clipDur > 0) {
      // Play just a short segment from the middle of the file.
      source.start(0, clipStart, clipDur);
    } else {
      source.start(0);
    }
  } catch (e) {
    // Silently fail - audio is non-critical
  }
}

/**
 * Play a non-spatial UI/feedback sound at a flat volume.
 *
 * Uses a Web Audio buffer source — this does NOT create an HTMLAudioElement
 * (WebMediaPlayer), so it cannot leak against Chrome's ~1000-player cap the
 * way per-event `new Audio()` does. The buffer is fetched+decoded once and
 * cached; subsequent plays are allocation-light.
 */
export async function playSound(url: string, volume: number = 0.5): Promise<void> {
  if (volume <= 0.01) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const buffer = await loadAudioBuffer(url);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
  } catch (e) {
    // Silently fail - audio is non-critical
  }
}

/**
 * Play a true 3D positional sound using PannerNode
 * Listeners with headphones can hear directionality
 * Used for long-range sounds like yodels that need to carry far
 */
export async function play3DPositionalSound(
  url: string,
  sourcePosition: THREE.Vector3,
  listenerPosition: THREE.Vector3,
  listenerDirection: THREE.Vector3, // Camera forward direction
  options: {
    baseVolume?: number;
    playbackRate?: number;
    maxDistance?: number;
    refDistance?: number;
    rolloffFactor?: number;
  } = {}
): Promise<void> {
  const {
    baseVolume = 0.7,
    playbackRate = 1.0,
    maxDistance = YODEL_MAX_DISTANCE,
    refDistance = YODEL_REFERENCE_DISTANCE,
    rolloffFactor = YODEL_ROLLOFF_FACTOR,
  } = options;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const buffer = await loadAudioBuffer(url);
    if (!buffer) return;

    // Create audio nodes
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = ctx.createGain();
    gainNode.gain.value = baseVolume;

    // Create PannerNode for 3D positioning
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; // Head-related transfer function for realistic 3D
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = rolloffFactor;
    panner.coneInnerAngle = 360; // Omnidirectional source
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;

    // Set sound source position
    panner.positionX.setValueAtTime(sourcePosition.x, ctx.currentTime);
    panner.positionY.setValueAtTime(sourcePosition.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(sourcePosition.z, ctx.currentTime);

    // Set listener position and orientation
    const listener = ctx.listener;

    // Position
    if (listener.positionX) {
      listener.positionX.setValueAtTime(listenerPosition.x, ctx.currentTime);
      listener.positionY.setValueAtTime(listenerPosition.y, ctx.currentTime);
      listener.positionZ.setValueAtTime(listenerPosition.z, ctx.currentTime);
    } else {
      // Fallback for older browsers
      listener.setPosition(listenerPosition.x, listenerPosition.y, listenerPosition.z);
    }

    // Orientation (forward direction and up vector)
    if (listener.forwardX) {
      listener.forwardX.setValueAtTime(listenerDirection.x, ctx.currentTime);
      listener.forwardY.setValueAtTime(listenerDirection.y, ctx.currentTime);
      listener.forwardZ.setValueAtTime(listenerDirection.z, ctx.currentTime);
      listener.upX.setValueAtTime(0, ctx.currentTime);
      listener.upY.setValueAtTime(1, ctx.currentTime);
      listener.upZ.setValueAtTime(0, ctx.currentTime);
    } else {
      // Fallback for older browsers
      listener.setOrientation(
        listenerDirection.x, listenerDirection.y, listenerDirection.z,
        0, 1, 0
      );
    }

    // Connect: source -> gain -> panner -> destination
    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(ctx.destination);
    source.start(0);
  } catch (e) {
    // Silently fail - audio is non-critical
  }
}

/**
 * Preload audio files for instant playback
 */
export async function preloadSpatialSounds(urls: string[]): Promise<void> {
  await Promise.all(urls.map(url => loadAudioBuffer(url)));
}

// Shwarm sound URLs
export const SHWARM_SOUNDS = [
  '/shwarm_sound_1.mp3',
  '/shwarm_sound_2.mp3',
  '/shwarm_sound_3.mp3',
];

// Shnake sound URLs
export const SHNAKE_SOUND = '/shnake_sound_1.mp3';
export const SHNAKE_DEATH_SOUND = '/shnake_death.mp3';

// Wisp sound URLs
export const WISP_DEATH_SOUND = '/wisp_death.mp3';

// Yodel sound URLs
export const YODEL_SOUND = '/yodel_1.mp3';

// Preload sounds on module load (with error handling to avoid blocking)
preloadSpatialSounds([...SHWARM_SOUNDS, SHNAKE_SOUND, SHNAKE_DEATH_SOUND, WISP_DEATH_SOUND, YODEL_SOUND]).catch((e) => {
  console.warn('[SpatialAudio] Failed to preload sounds:', e);
});
