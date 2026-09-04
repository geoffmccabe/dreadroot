import { useState, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BlocksProvider } from "@/contexts/BlocksContext";
import { UserPanelProvider } from "@/contexts/UserPanelContext";
import { AdminPanelProvider } from "@/contexts/AdminPanelContext";
import { CoinThemeProvider } from "@/contexts/CoinThemeContext";
import { PanelThemeProvider } from "@/theme/PanelThemeProvider";
import { AvatarProvider } from "@/contexts/AvatarContext";
import { InitializationProvider, useInitialization } from "@/contexts/InitializationContext";
import { BulletDefinitionsProvider } from "@/contexts/BulletDefinitionsContext";
import { FlamethrowerTiersProvider } from "@/contexts/FlamethrowerTiersContext";
import { ItemDetailProvider } from "@/contexts/ItemDetailContext";
import { ItemDetailModal } from "@/components/ItemDetailModal";
import { VaultBridgeProvider } from "@/contexts/VaultBridgeContext";
import { InitializationOverlay } from "@/components/InitializationOverlay";
import { BOOT_MAP } from "@/config/game";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ClearSession from "./pages/ClearSession";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";

/**
 * ⚠ TEMPORARY, TESTING ONLY. On a boot-map build (the Starblink deploy) the game lets you
 * straight in: it signs you in as a guest by itself and skips the branded START GAME screen, so
 * opening the URL drops you into the world after the loading logs and nothing else.
 *
 * This is deliberately scoped to builds with VITE_BOOT_MAP set. dreadroot.com does NOT set it, so
 * its login gate and homescreen are untouched.
 *
 * TO REMOVE when Starblink stops being a test target: delete this constant and the two effects
 * that read it in ProtectedRoute below. Nothing else depends on it.
 */
const TESTING_AUTO_ENTER = !!BOOT_MAP;

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, session, signInAsGuest } = useAuth();
  const { setGameStarted } = useInitialization();
  // In-memory (not persisted), so the homescreen shows on every app start /
  // reload. Logged-in players see the branded screen + START GAME before the
  // world loads, instead of being dropped straight into the game.
  const [started, setStarted] = useState(false);
  const isGuest = user?.is_anonymous === true;
  const autoGuestTried = useRef(false);

  // TESTING ONLY (see TESTING_AUTO_ENTER). Make a guest account without being asked, so the
  // login screen never appears. Guarded by a ref, not by state: anonymous sign-in is a network
  // round trip and a re-render mid-flight would otherwise mint a second throwaway account.
  useEffect(() => {
    if (!TESTING_AUTO_ENTER || isLoading || user || autoGuestTried.current) return;
    autoGuestTried.current = true;
    void signInAsGuest().catch((e) => console.error('[auto-enter] guest sign-in failed', e));
  }, [isLoading, user, signInAsGuest]);

  // TESTING ONLY. Skip the branded START GAME screen once there is a session. The loading logs
  // still show, because those come from the init overlay after gameStarted flips.
  useEffect(() => {
    if (!TESTING_AUTO_ENTER || started || !user) return;
    if (!session?.user?.email && !isGuest) return;   // wait for a usable session
    setGameStarted(true);
    setStarted(true);
  }, [started, user, session, isGuest, setGameStarted]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  // A guest ("Play Without Account") is a Supabase ANONYMOUS user: a real auth
  // user with a real uid, but no email. That is the one case allowed through
  // without one. Everything else still needs an email — which is what keeps
  // out the broken half-sessions from the old auth system this check was
  // originally written for.
  if (!user || (!session?.user?.email && !isGuest)) {
    // On a testing build we are signing a guest in right now, so hold the screen instead of
    // bouncing to the login page we are trying to avoid.
    if (TESTING_AUTO_ENTER) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-xl">Entering...</div>
        </div>
      );
    }
    return <Navigate to="/auth" replace />;
  }

  // Logged in: show the homescreen with START GAME until the player clicks it.
  // Flip gameStarted too, so the init overlay only appears after START (it may
  // have been initializing in the background meanwhile).
  //
  // GUESTS SEE THIS TOO. They used to skip it, on the reasoning that clicking
  // PLAY WITHOUT ACCT already IS the start action — but a guest session
  // PERSISTS, so from the second visit onward that skipped the branded screen
  // on every single load and dropped straight into the world with no way back
  // to sign in. The fast path belongs to the button that was just pressed, not
  // to the account type forever; the button navigates on its own.
  if (!started) {
    return <Auth onStart={() => { setGameStarted(true); setStarted(true); }} />;
  }

  return <>{children}</>;
}

// Auth route wrapper (redirect if already authenticated)
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, session } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  
  // Only redirect if user has a valid email (not anonymous)
  if (user && session?.user?.email) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <CoinThemeProvider>
          <PanelThemeProvider />
          <InitializationProvider>
            <InitializationOverlay />
            <BulletDefinitionsProvider>
            <FlamethrowerTiersProvider>
              <BlocksProvider>
                <AvatarProvider>
                  <UserPanelProvider>
                    <AdminPanelProvider>
                      <ItemDetailProvider>
                      <VaultBridgeProvider>
                      <Toaster />
                      <Sonner />
                      <ItemDetailModal />
                      <BrowserRouter>
                        <Routes>
                          <Route path="/clear-session" element={<ClearSession />} />
                          {/* Public: SSO returns here with token in URL fragment.
                              Must NOT be wrapped in Auth/ProtectedRoute. */}
                          <Route path="/auth/callback" element={<AuthCallback />} />
                          <Route 
                            path="/" 
                            element={
                              <ProtectedRoute>
                                <Index />
                              </ProtectedRoute>
                            } 
                          />
                          <Route 
                            path="/auth" 
                            element={
                              <AuthRoute>
                                <Auth />
                              </AuthRoute>
                            } 
                          />
                          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </BrowserRouter>
                      </VaultBridgeProvider>
                      </ItemDetailProvider>
                    </AdminPanelProvider>
                  </UserPanelProvider>
                </AvatarProvider>
              </BlocksProvider>
            </FlamethrowerTiersProvider>
            </BulletDefinitionsProvider>
          </InitializationProvider>
        </CoinThemeProvider>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
