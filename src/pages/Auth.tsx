import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/version';

// SSO-only login gate. Layers, back -> front:
//  1. YouTube video (muted autoplay, full-bleed cover). The IFrame API
//     BUILDS the player itself (host = youtube-nocookie) on a node React
//     never reconciles -- attaching the API to a hand-written iframe was
//     unreliable. Looped via onStateChange (no &loop/&playlist, which is
//     what drew the center pause + prev/next). A transparent shield over
//     the video eats every hover/tap so no control chrome can ever appear.
//  2. Background art, mix-blend-mode:screen (its black areas go transparent
//     so the video shows through them).
//  3. Pulsing black filter (60% <-> 75% / 10s) OVER the whole background and
//     UNDER the logos -- must sit above the screen-blend layer or it cancels.
//  4. Content: present logo, Dreadroot wordmark (two color variants
//     crossfading on a 10s loop), LOGIN.
// Email/password still exists in AuthContext (no UI) as a break-glass path.
const YT_ID = 'roFE8vJHi-A';

function ytApiReady(): Promise<void> {
  return new Promise((resolve) => {
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
}

// Doubles as the post-login HOMESCREEN: when `onStart` is passed (logged-in
// player, world initializing in the background), the button reads START GAME and
// enters the world; otherwise it's the LOGIN gate.
export default function Auth({ onStart }: { onStart?: () => void }) {
  const { signInWithSSO, signInAsGuest } = useAuth();
  const navigate = useNavigate();
  const [guestBusy, setGuestBusy] = useState(false);

  /**
   * Play without an account.
   *
   * NAVIGATES EXPLICITLY on success, and that is the whole fix: the guest sign
   * in was already working, but nothing moved them off this screen afterwards.
   * AuthRoute only redirects users who have an EMAIL — deliberately, so a guest
   * can come back here later to convert — and a guest has none. So the account
   * was created, the session was live, and the login page just sat there, which
   * from the outside is indistinguishable from a dead button.
   *
   * The busy flag matters too: anonymous sign-in is a network round trip, and
   * without it an impatient second click creates a SECOND throwaway account and
   * abandons the first.
   */
  const startGuest = async () => {
    if (guestBusy) return;
    setGuestBusy(true);
    try {
      const { error } = await signInAsGuest();
      if (!error) { navigate('/', { replace: true }); return; }
      setGuestBusy(false);
    } catch (err) {
      // Logged, not swallowed. A silent catch here is precisely why the only
      // report possible was "clicking does nothing".
      console.error('[guest] start failed', err);
      setGuestBusy(false);
    }
  };
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let player: any = null;

    // The API replaces this node with its iframe. It lives inside `host`
    // but is created/destroyed imperatively, so React never fights it.
    const mount = document.createElement('div');
    host.appendChild(mount);

    ytApiReady().then(() => {
      if (cancelled) return;
      const w = window as any;
      player = new w.YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId: YT_ID,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute();
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            // 0 === ENDED: restart seamlessly (never reaches the end
            // screen / replay chrome).
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
        player?.destroy?.();
      } catch {
        /* player may already be gone */
      }
      host.innerHTML = '';
    };
  }, []);

  // Enter also starts the game / logs in — no need to click the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') (onStart ?? signInWithSSO)(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart, signInWithSSO]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">
      <style>{`
@keyframes authBlackPulse{0%,100%{opacity:.75}50%{opacity:.60}}
@keyframes dreadrootCrossfade{0%,100%{opacity:0}50%{opacity:1}}
@keyframes authFadeIn{from{opacity:0}to{opacity:1}}
@keyframes authBgIn{from{opacity:0}to{opacity:.5}}
#bg-yt-host iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;pointer-events:none;}
`}</style>

      {/* 1. YouTube background — API builds the iframe inside this node */}
      <div
        id="bg-yt-host"
        ref={hostRef}
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
        style={{
          width: '100vw',
          height: '56.25vw',
          minWidth: '177.78vh',
          minHeight: '100vh',
          pointerEvents: 'none',
          // Reveal LAST in the intro sequence (logos → background → button → video).
          animation: 'authFadeIn 1.2s ease-out 1.8s both',
        }}
      />

      {/* 1b. Transparent shield — absorbs every hover/tap so YouTube never
             draws controls. Below content (z-10) so LOGIN stays clickable. */}
      <div
        className="absolute inset-0 z-[5]"
        style={{ pointerEvents: 'auto', background: 'transparent' }}
        aria-hidden="true"
      />

      {/* 2. Background art — screen blend turns its black transparent over video */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url('/UserPanel_bkgd_2400px.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          mixBlendMode: 'screen',
          // Reveal SECOND (after the logos), fading to its 0.5 working opacity.
          animation: 'authBgIn 1s ease-out .7s both',
        }}
      />

      {/* 3. Pulsing black filter between background and logos (60% <-> 75%) */}
      <div
        className="absolute inset-0 bg-black pointer-events-none"
        style={{ animation: 'authBlackPulse 10s ease-in-out infinite' }}
      />

      {/* 4. Content */}
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6">
        {/* TOP: Lightningworks + AWC present. aspectRatio reserves its height before the image
            bytes load, so the centred column never reflows (the button no longer "drops"). Fades
            in FIRST. */}
        <img
          src="/lw_awc_present_1600px.webp"
          alt="Lightningworks + AWC present"
          className="w-[55%] md:w-[40%] h-auto block"
          style={{ aspectRatio: '1600 / 879', animation: 'authFadeIn .8s ease-out .15s both' }}
        />
        {/* BELOW: Dreadroot wordmark — two color variants crossfading on a
            10s loop (variant fades in over 5s, back out over 5s). The base
            img is in normal flow and sets the box height; the variant is
            absolutely stacked over it at the same size. */}
        <div className="relative w-[88%] md:w-[66%]" style={{ aspectRatio: '2400 / 600', animation: 'authFadeIn .8s ease-out .15s both' }}>
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
        <div className="flex flex-col items-center gap-2" style={{ animation: 'authFadeIn .8s ease-out 1.3s both' }}>
          <Button
            type="button"
            onClick={onStart ?? signInWithSSO}
            className="h-12 px-10 text-lg font-bold tracking-widest"
          >
            {onStart ? 'START GAME' : 'LOGIN'}
          </Button>
          {/* Guest entry. Only on the LOGIN gate — once you are in, the
              button above is START GAME and this would make no sense. */}
          {!onStart && (
            <button
              type="button"
              onClick={() => { void startGuest(); }}
              disabled={guestBusy}
              className="mt-1 text-sm font-semibold tracking-wide text-white/70 hover:text-white underline underline-offset-4 transition-colors disabled:opacity-60"
            >
              {guestBusy ? 'STARTING…' : 'PLAY WITHOUT ACCT'}
            </button>
          )}
          {/* Build version, small, right under the button. */}
          <span className="font-mono text-xs text-white/55 select-none pointer-events-none">
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}
