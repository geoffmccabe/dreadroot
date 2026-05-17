import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

// SSO-only login gate. The fully-branded login (logo + side image + theme)
// lives on the Lightningworks SSO page itself (set in the SSO admin panel,
// integration-doc Step 4). This is just an in-game-styled hand-off screen.
// Email/password still exists in AuthContext (no UI) as a break-glass path.
export default function Auth() {
  const { signInWithSSO } = useAuth();

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 bg-cover bg-center"
      style={{
        backgroundImage:
          "linear-gradient(hsla(208,85%,6%,0.72), hsla(208,85%,6%,0.86)), url('/space_night_sky.webp')",
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        className="w-full max-w-md rounded-xl px-8 py-10 text-center shadow-2xl"
        style={{
          backgroundColor: 'hsla(211, 30%, 51%, 0.18)',
          border: '1px solid hsla(211, 34%, 73%, 0.45)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <h1
          className="mb-2 text-5xl font-extrabold tracking-[0.2em]"
          style={{ color: 'hsl(211, 32%, 92%)', textShadow: '0 2px 18px hsla(211,80%,60%,0.5)' }}
        >
          DREADROOT
        </h1>
        <p className="mb-8 text-sm" style={{ color: 'hsl(211, 24%, 75%)' }}>
          Sign in with your Lightningworks account to enter the world.
        </p>
        <Button
          type="button"
          className="w-full h-11 text-base font-semibold"
          onClick={signInWithSSO}
        >
          Sign in with Lightningworks
        </Button>
      </div>
    </div>
  );
}
