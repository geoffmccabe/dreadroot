import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

// SSO-only login gate. Layers, back -> front:
//  1. YouTube video (muted autoplay, full-bleed cover). Looped via the
//     IFrame JS API, NOT &loop=1&playlist=ID -- the playlist param is what
//     makes YouTube draw the center pause + the prev/next arrows. With no
//     playlist, controls=0, and an unclickable iframe, no player chrome
//     ever appears.
//  2. Background art, mix-blend-mode:screen (its black areas go transparent
//     so the video shows through them).
//  3. Pulsing black filter (60% <-> 75% / 10s) OVER the whole background and
//     UNDER the logos -- must sit above the screen-blend layer or it cancels.
//  4. Content: present logo, Dreadroot wordmark (two color variants
//     crossfading on a 10s loop), LOGIN.
// Email/password still exists in AuthContext (no UI) as a break-glass path.
const YT_ID = 'roFE8vJHi-A';

export default function Auth() {
  const { signInWithSSO } = useAuth();
  const playerRef = useRef<unknown>(null);

  // Loop the video through the IFrame API instead of &loop=1&playlist=ID,
  // so YouTube never renders its playlist transport (pause / prev / next).
  useEffect(() => {
    let cancelled = false;

    const apiReady = () =>
      new Promise<void>((resolve) => {
        const w = window as any;
        if (w.YT?.Player) return resolve();
        const prev = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = () => {
          prev?.();
          resolve();
        };
        if (!document.querySelector('script[data-yt-api]')) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          s.dataset.ytApi = '1';
          document.head.appendChild(s);
        }
      });

    apiReady().then(() => {
      if (cancelled || playerRef.current) return;
      const w = window as any;
      playerRef.current = new w.YT.Player('bg-yt', {
        events: {
          onReady: (e: any) => {
            e.target.mute();
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            // 0 === ENDED: restart seamlessly (no end screen, no controls).
            if (e.data === 0) {
              e.target.seekTo(0, true);
              e.target.playVideo();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try {
        (playerRef.current as any)?.destroy?.();
      } catch {
        /* player may already be gone */
      }
      playerRef.current = null;
    };
  }, []);

  const ytSrc =
    `https://www.youtube-nocookie.com/embed/${YT_ID}` +
    `?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1` +
    `&rel=0&playsinline=1&fs=0&iv_load_policy=3&enablejsapi=1` +
    (typeof window !== 'undefined'
      ? `&origin=${encodeURIComponent(window.location.origin)}`
      : '');

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">
      <style>{`
@keyframes authBlackPulse{0%,100%{opacity:.75}50%{opacity:.60}}
@keyframes dreadrootCrossfade{0%,100%{opacity:0}50%{opacity:1}}
`}</style>

      {/* 1. YouTube background (looped via JS API; no playlist => no chrome) */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <iframe
          id="bg-yt"
          src={ytSrc}
          title="background"
          tabIndex={-1}
          allow="autoplay; encrypted-media; picture-in-picture"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: '100vw',
            height: '56.25vw',
            minWidth: '177.78vh',
            minHeight: '100vh',
            border: 0,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* 2. Background art — screen blend turns its black transparent over video */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url('/UserPanel_bkgd_2400px.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          opacity: 0.5,
          mixBlendMode: 'screen',
        }}
      />

      {/* 3. Pulsing black filter between background and logos (60% <-> 75%) */}
      <div
        className="absolute inset-0 bg-black pointer-events-none"
        style={{ animation: 'authBlackPulse 10s ease-in-out infinite' }}
      />

      {/* 4. Content */}
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6">
        {/* TOP: Lightningworks + AWC present */}
        <img
          src="/lw_awc_present_1600px.webp"
          alt="Lightningworks + AWC present"
          className="w-[55%] md:w-[40%] h-auto block"
        />
        {/* BELOW: Dreadroot wordmark — two color variants crossfading on a
            10s loop (variant fades in over 5s, back out over 5s). The base
            img is in normal flow and sets the box height; the variant is
            absolutely stacked over it at the same size. */}
        <div className="relative w-[88%] md:w-[66%]">
          <img
            src="/Dreadroot_words_logo_horiz_2400px.webp"
            alt="Dreadroot"
            className="w-full h-auto block"
          />
          <img
            src="/Dreadroot_words_logo_horiz2_2400px.webp"
            alt=""
            aria-hidden="true"
            className="absolute left-0 top-0 w-full h-auto block pointer-events-none"
            style={{ animation: 'dreadrootCrossfade 10s ease-in-out infinite' }}
          />
        </div>
        <Button
          type="button"
          onClick={signInWithSSO}
          className="h-12 px-10 text-lg font-bold tracking-widest"
        >
          LOGIN
        </Button>
      </div>
    </div>
  );
}
