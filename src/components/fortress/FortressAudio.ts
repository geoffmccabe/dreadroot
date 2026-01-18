// Audio management utilities for the Fortress game

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
    wispBoom: new Audio('/space_gunshot.mp3'),
    wispCheer: new Audio('/coin_hit_sound.mp3'),
    // Shwarm sounds
    shwarmHit: new Audio('/brick_drop_sound.mp3'),
    playerHit: new Audio('/wooden_thud_sound.mp3'),
    shwarmGroupKilled: new Audio('/yay_sound.mp3')
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

// Play reversed audio for block removal
export async function playReversedAudio(audioUrl: string): Promise<void> {
  try {
    const audioContext = createAudioContext();
    if (!audioContext) return;

    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create reversed buffer
    const reversedBuffer = audioContext.createBuffer(
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

    const source = audioContext.createBufferSource();
    source.buffer = reversedBuffer;
    source.connect(audioContext.destination);
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
