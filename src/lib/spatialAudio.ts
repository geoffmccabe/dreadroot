// Spatial Audio System with distance-based falloff
// Uses Web Audio API for overlapping sounds

let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const loadingPromises = new Map<string, Promise<AudioBuffer>>();

// Audio distance parameters
const MAX_AUDIO_DISTANCE = 50; // Beyond this, sounds are silent
const REFERENCE_DISTANCE = 5;  // Distance at which sound is at full volume
const ROLLOFF_FACTOR = 1.5;    // How quickly sound fades with distance

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
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(url, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.warn(`Failed to load audio: ${url}`, error);
      throw error;
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
  } = {}
): Promise<void> {
  const { baseVolume = 0.5, playbackRate = 1.0, detune = 0 } = options;
  
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

// Preload sounds on module load (with error handling to avoid blocking)
preloadSpatialSounds([...SHWARM_SOUNDS, SHNAKE_SOUND, SHNAKE_DEATH_SOUND, WISP_DEATH_SOUND]).catch((e) => {
  console.warn('[SpatialAudio] Failed to preload sounds:', e);
});
