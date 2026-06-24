// SciFiCityMusic — loops the SciFi City soundtrack at 70% volume while the city map is active.
// Mounted only inside the city-demo block of SiegeWorldLayers, so it starts on entry and stops on
// exit (unmount). Browsers block autoplay until a user gesture, so if the first play() is rejected
// we retry once on the next pointer/key input.
import { useEffect } from 'react';

const SRC = '/SciFi_City_Soundtrack.mp3';
const VOLUME = 0.7;

export function SciFiCityMusic() {
  useEffect(() => {
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.volume = VOLUME;
    let cleanupGesture: (() => void) | null = null;
    const tryPlay = () => audio.play().catch(() => {
      // Autoplay blocked → arm a one-shot gesture listener to start it.
      if (cleanupGesture) return;
      const onGesture = () => { audio.play().catch(() => {}); cleanup(); };
      const cleanup = () => {
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
        cleanupGesture = null;
      };
      cleanupGesture = cleanup;
      window.addEventListener('pointerdown', onGesture, { once: true });
      window.addEventListener('keydown', onGesture, { once: true });
    });
    tryPlay();
    return () => {
      cleanupGesture?.();
      audio.pause();
      audio.src = '';
    };
  }, []);
  return null;
}
