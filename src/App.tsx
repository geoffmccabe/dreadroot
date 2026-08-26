import { useState, useEffect } from "react";
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
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ClearSession from "./pages/ClearSession";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, session } = useAuth();
  const { setGameStarted } = useInitialization();
  // In-memory (not persisted), so the homescreen shows on every app start /
  // reload. Logged-in players see the branded screen + START GAME before the
  // world loads, instead of being dropped straight into the game.
  const [started, setStarted] = useState(false);
  const isGuest = user?.is_anonymous === true;

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
