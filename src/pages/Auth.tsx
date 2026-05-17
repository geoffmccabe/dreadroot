import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

// SSO-only login gate. Email/password still exists in AuthContext (no UI)
// as a break-glass path. Branded artwork per Geoff's spec.
export default function Auth() {
  const { signInWithSSO } = useAuth();

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6"
      style={{
        backgroundImage: "url('/UserPanel_bkgd_2400px.webp')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Main banner: 80% width on mobile, 60% on desktop */}
      <img
        src="/Dreadroot_words_logo_horiz_2400px.webp"
        alt="Dreadroot"
        className="w-[80%] md:w-[60%] h-auto block"
      />

      {/* Presents: 55% width on mobile, 40% on desktop */}
      <img
        src="/lw+awc_presents_1600px.webp"
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
  );
}
