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
import { AvatarProvider } from "@/contexts/AvatarContext";
import { InitializationProvider } from "@/contexts/InitializationContext";
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
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  
  // Reject anonymous users (from old auth system) or users without email
  if (!user || !session?.user?.email) {
    return <Navigate to="/auth" replace />;
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
