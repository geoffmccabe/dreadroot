import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Lightningworks SSO callback. SSO returns here with the token in the URL
// HASH fragment (#access_token=...). We hand it to the sso-exchange edge
// function, which verifies it and returns a magiclink token_hash; we complete
// that via verifyOtp() to get a normal DreadRoot Supabase session.
export default function AuthCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return; // guard StrictMode double-invoke
    ran.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      // Scrub tokens from the URL/history immediately.
      history.replaceState(null, '', window.location.pathname);

      if (!accessToken) {
        setError('No SSO token returned. Please try signing in again.');
        return;
      }

      try {
        const { data, error: fnErr } = await supabase.functions.invoke('sso-exchange', {
          body: { access_token: accessToken },
        });
        if (fnErr || !data?.token_hash) {
          throw new Error(data?.error || fnErr?.message || 'SSO exchange failed');
        }
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: 'magiclink',
        });
        if (otpErr) throw new Error(otpErr.message);
        // onAuthStateChange in AuthContext picks up the session.
        navigate('/', { replace: true });
      } catch (e) {
        console.error('[SSO callback]', e);
        setError((e as Error).message || 'SSO sign-in failed.');
        toast.error('SSO sign-in failed.');
      }
    })();
  }, [navigate]);

  const arialBlack = {
    fontFamily: '"Arial Black", "Arial Bold", Gadget, Arial, sans-serif',
    fontWeight: 900 as const,
    color: '#ffffff',
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-8 p-6 text-center bg-black">
      <img
        src="/Dreadroot_words_logo_horiz_2400px.webp"
        alt="Dreadroot"
        className="w-[80%] max-w-md h-auto block"
      />
      {error ? (
        <div className="space-y-4">
          <p style={arialBlack} className="text-base">{error}</p>
          <button
            style={arialBlack}
            className="underline text-base"
            onClick={() => navigate('/auth', { replace: true })}
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <p style={arialBlack} className="text-xl tracking-wide">
          Logging you in…
        </p>
      )}
    </div>
  );
}
