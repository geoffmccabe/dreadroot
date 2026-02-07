// Audio management utilities for the Fortress game

/**
 * Play a one-shot audio effect that auto-cleans up after playback.
 * Prevents WebMediaPlayer accumulation (Chrome limits ~75-150 concurrent).
 */
export function playOneShot(url: string, volume: number = 0.3): void {
  const audio = new Audio(url);
  audio.volume = volume;
  audio.play().catch(() => {});
  // Auto-cleanup: release the WebMediaPlayer when done or on error
  audio.onended = () => { audio.src = ''; };
  audio.onerror = () => { audio.src = ''; };
}

// Create and initialize audio context
export function createAudioContext(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch (e) {
    console.warn('Web Audio API not supported');
    return null;
  }
}

// Initialize audio elements with optimized settings
export function initializeAudioElements(audioElements: Record<string, HTMLAudioElement>): void {
  Object.entries(audioElements).forEach(([key, audio]) => {
    audio.volume = key === 'gunshot' ? 0.2 : 0.4;
    audio.preload = 'auto';
    audio.load();
  });
}

// Create audio refs object
export function createAudioRefs() {
  return {
    pistolCocking: new Audio('/pistol_cocking_sound.mp3'),
    pistolHolster: new Audio('/holster_pistol_sound.mp3'),
    gunshot: new Audio('/space_gunshot.mp3'),
    coinHit: new Audio('/coin_hit_sound.mp3'),
    woodenThud: new Audio('/wooden_thud_sound.mp3'),
    wispBoom: new Audio('/wisp_death.mp3'),
    wispCheer: new Audio('/coin_hit_sound.mp3'),
    // Shwarm sounds
    shwarmHit: new Audio('/brick_drop_sound.mp3'),
    playerHit: new Audio('/wooden_thud_sound.mp3'),
    shwarmGroupKilled: new Audio('/yay_sound.mp3'),
    // Tree sounds
    axeChop: new Audio('/axe_chop.mp3'),
    // Bullet ricochet sound
    ricochet: new Audio('/ricochet_sound.mp3'),
    // Pentabullet sounds
    pentabulletFire: new Audio('/pentabullet_sound.mp3'),
    pentabulletPowerup: new Audio('/pentabullet_powerup.mp3'),
    pentabulletSteady: new Audio('/pentabullet_power_steady.mp3'),
    pentabulletPowerdown: new Audio('/pentabullet_powerdown.mp3')
  };
}

// Create main audio refs (for placement sounds)
export function createMainAudioRefs() {
  return {
    woodenThud: new Audio('/wooden_thud_sound.mp3')
  };
}

// Preload rejection sound for instant playback
export async function preloadRejectionSound(): Promise<{ audioContext: AudioContext | null; buffer: AudioBuffer | null }> {
  try {
    const audioContext = createAudioContext();
    if (!audioContext) {
      return { audioContext: null, buffer: null };
    }

    const response = await fetch('/wooden_thud_sound.mp3');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    
    return { audioContext, buffer };
  } catch (error) {
    console.warn('Failed to preload rejection sound:', error);
    return { audioContext: null, buffer: null };
  }
}

// Play rejection sound with modified pitch and duration
export function playRejectionSound(rejectionData: { audioContext: AudioContext | null; buffer: AudioBuffer | null }): void {
  try {
    if (!rejectionData?.buffer) return;

    let ctx = rejectionData.audioContext;
    if (!ctx || ctx.state === 'closed') {
      ctx = createAudioContext();
      if (!ctx) return;
    }
    
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = rejectionData.buffer;
    source.playbackRate.value = 1.0;
    source.detune.value = -1712; // 70% of previous pitch

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1.5; // 50% louder

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);

    // Stop after half the duration
    const halfDuration = rejectionData.buffer.duration / 2;
    source.stop(ctx.currentTime + halfDuration);
  } catch (e) {
    console.warn('Could not play rejection sound:', e);
  }
}

// Shared AudioContext for reversed audio (reused across calls)
let sharedReversedCtx: AudioContext | null = null;
// Cache decoded + reversed buffers to avoid re-fetching
const reversedBufferCache = new Map<string, AudioBuffer>();

// Play reversed audio for block removal
export async function playReversedAudio(audioUrl: string): Promise<void> {
  try {
    if (!sharedReversedCtx || sharedReversedCtx.state === 'closed') {
      sharedReversedCtx = createAudioContext();
    }
    if (!sharedReversedCtx) return;
    if (sharedReversedCtx.state === 'suspended') {
      await sharedReversedCtx.resume();
    }

    let reversedBuffer = reversedBufferCache.get(audioUrl);
    if (!reversedBuffer) {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await sharedReversedCtx.decodeAudioData(arrayBuffer);

      reversedBuffer = sharedReversedCtx.createBuffer(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const inputData = audioBuffer.getChannelData(channel);
        const outputData = reversedBuffer.getChannelData(channel);
        for (let i = 0; i < audioBuffer.length; i++) {
          outputData[i] = inputData[audioBuffer.length - 1 - i];
        }
      }
      reversedBufferCache.set(audioUrl, reversedBuffer);
    }

    const source = sharedReversedCtx.createBufferSource();
    source.buffer = reversedBuffer;
    source.connect(sharedReversedCtx.destination);
    source.start(0);
  } catch (error) {
    console.warn('Failed to play reversed sound:', error);
  }
}

// Throttled audio play function
export function createThrottledAudioPlayer(throttleMs: number = 100) {
  let lastAudioTime = 0;

  return async function playAudio(
    audio: HTMLAudioElement,
    audioContext: AudioContext | null
  ): Promise<void> {
    const now = Date.now();
    if (now - lastAudioTime < throttleMs) {
      return;
    }

    try {
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (audio.readyState >= 2) {
        audio.currentTime = 0;
        await audio.play();
        lastAudioTime = now;
      }
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  };
}

// ============== AMBIENT AUDIO ==============

const DEFAULT_AMBIENT_URL = '/ambient_alien_planet_bkgd_1.mp3';
const DEFAULT_AMBIENT_VOLUME = 100; // 100% = 0.3 base volume

let ambientAudio: HTMLAudioElement | null = null;
let ambientAudioLoaded = false;
let currentAmbientUrl: string | null = null;
let currentVolumePercent = DEFAULT_AMBIENT_VOLUME;

// Convert 0-200% slider to actual volume (0-200% maps to 0-0.6 audio volume)
function percentToVolume(percent: number): number {
  return (percent / 100) * 0.3; // 100% = 0.3, 200% = 0.6
}

/**
 * Preload ambient audio during initialization
 * Returns a promise that resolves when audio is loaded
 */
export async function preloadAmbientAudio(url?: string | null): Promise<boolean> {
  const targetUrl = url || DEFAULT_AMBIENT_URL;

  // If same URL is already loaded, just return true
  if (ambientAudioLoaded && ambientAudio && currentAmbientUrl === targetUrl) {
    return true;
  }

  // If different URL, stop current and load new
  if (ambientAudio && currentAmbientUrl !== targetUrl) {
    stopAmbientAudio();
    ambientAudioLoaded = false;
  }

  currentAmbientUrl = targetUrl;

  return new Promise((resolve) => {
    try {
      ambientAudio = new Audio(targetUrl);
      ambientAudio.volume = percentToVolume(currentVolumePercent);
      ambientAudio.loop = true;
      ambientAudio.preload = 'auto';

      ambientAudio.addEventListener('canplaythrough', () => {
        ambientAudioLoaded = true;
        resolve(true);
      }, { once: true });

      ambientAudio.addEventListener('error', (e) => {
        console.warn('[AmbientAudio] Failed to load:', e);
        resolve(false);
      }, { once: true });

      // Start loading
      ambientAudio.load();

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!ambientAudioLoaded) {
          console.warn('[AmbientAudio] Load timeout');
          resolve(false);
        }
      }, 10000);
    } catch (e) {
      console.warn('[AmbientAudio] Error creating audio element:', e);
      resolve(false);
    }
  });
}

/**
 * Start playing the ambient audio (call after initialization completes)
 */
export function startAmbientAudio(): void {
  if (!ambientAudio || !ambientAudioLoaded) {
    console.warn('[AmbientAudio] Not loaded yet');
    return;
  }

  ambientAudio.play().catch((e) => {
    // Autoplay blocked - will need user interaction
    console.warn('[AmbientAudio] Autoplay blocked, waiting for user interaction');

    // Add one-time click handler to start audio
    const startOnInteraction = () => {
      if (ambientAudio) {
        ambientAudio.play().catch(() => {});
      }
      document.removeEventListener('click', startOnInteraction);
      document.removeEventListener('keydown', startOnInteraction);
    };

    document.addEventListener('click', startOnInteraction, { once: true });
    document.addEventListener('keydown', startOnInteraction, { once: true });
  });
}

/**
 * Stop the ambient audio
 */
export function stopAmbientAudio(): void {
  if (ambientAudio) {
    ambientAudio.pause();
    ambientAudio.currentTime = 0;
  }
}

/**
 * Set ambient audio volume (0-200 percent scale)
 */
export function setAmbientVolume(percent: number): void {
  currentVolumePercent = Math.max(0, Math.min(200, percent));
  if (ambientAudio) {
    ambientAudio.volume = percentToVolume(currentVolumePercent);
  }
}

/**
 * Change ambient music track (loads and plays new track)
 */
export async function changeAmbientTrack(url: string | null, volumePercent?: number): Promise<void> {
  if (volumePercent !== undefined) {
    currentVolumePercent = volumePercent;
  }

  if (!url) {
    stopAmbientAudio();
    currentAmbientUrl = null;
    ambientAudioLoaded = false;
    return;
  }

  const wasPlaying = ambientAudio && !ambientAudio.paused;
  await preloadAmbientAudio(url);

  if (wasPlaying) {
    startAmbientAudio();
  }
}

/**
 * Get current ambient audio state
 */
export function getAmbientAudioState(): { url: string | null; volume: number; isPlaying: boolean } {
  return {
    url: currentAmbientUrl,
    volume: currentVolumePercent,
    isPlaying: ambientAudio ? !ambientAudio.paused : false
  };
}
