import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { loadGuestIdentity, clearGuestIdentity } from '@/features/guest/guestIdentity';

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
        // Read the guest BEFORE signing in: verifyOtp replaces the session, and
        // with it any way of knowing which guest this device was playing as.
        const guest = await loadGuestIdentity();

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

        // CONVERSION. This device was playing as a guest and has now signed in
        // for real, so hand the guest's progress to the real account. The
        // server refuses if the real account already has items, so signing in
        // on a machine somebody else guested on can never overwrite your own
        // stuff. Failure here must not block the login — the player is signed
        // in either way, they would just keep the guest progress separate.
        if (guest?.deviceId && guest.guestUserId) {
          try {
            const { data: claim } = await supabase.rpc('claim_guest_account', {
              p_device_id: guest.deviceId,
              p_guest_user_id: guest.guestUserId,
            });
            const c = claim as { claimed?: boolean; migrated?: boolean } | null;
            if (c?.claimed) {
              await clearGuestIdentity();
              toast.success(c.migrated
                ? 'Your guest progress has been moved to your account.'
                : 'Signed in. Your existing account progress was kept.');
            }
          } catch (convErr) {
            console.error('[SSO callback] guest conversion failed', convErr);
          }
        }

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
