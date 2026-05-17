import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

// SSO-only login gate. Layers, back -> front:
//  1. YouTube video (muted autoplay loop, full-bleed cover) — streamed in
//     an iframe so it never blocks first paint; page renders immediately.
//  2. Pulsing black scrim (80% <-> 60% / 10s).
//  3. Background art, mix-blend-mode:screen so its black areas go
//     transparent and the video shows through them.
//  4. Content (logo / presents / LOGIN).
// Email/password still exists in AuthContext (no UI) as a break-glass path.
const YT_ID = 'roFE8vJHi-A';
const YT_SRC =
  `https://www.youtube-nocookie.com/embed/${YT_ID}` +
  `?autoplay=1&mute=1&loop=1&playlist=${YT_ID}&controls=0&disablekb=1` +
  `&modestbranding=1&rel=0&playsinline=1&fs=0&iv_load_policy=3`;

export default function Auth() {
  const { signInWithSSO } = useAuth();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">
      <style>{`@keyframes authBlackPulse{0%,100%{opacity:.80}50%{opacity:.60}}`}</style>

      {/* 1. Streamed YouTube background, scaled to cover */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <iframe
          src={YT_SRC}
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

      {/* 2. Pulsing black scrim over the video */}
      <div
        className="absolute inset-0 bg-black pointer-events-none"
        style={{ animation: 'authBlackPulse 10s ease-in-out infinite' }}
      />

      {/* 3. Background art — screen blend turns its black transparent */}
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

      {/* 4. Content */}
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6">
        <img
          src="/Dreadroot_words_logo_horiz_2400px.webp"
          alt="Dreadroot"
          className="w-[80%] md:w-[60%] h-auto block"
        />
        <img
          src="/lw_awc_presents_1600px.webp"
          alt="Lightningworks + AWC presents"
          className="w-[55%] md:w-[40%] h-auto block"
        />
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
