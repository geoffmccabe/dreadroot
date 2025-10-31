import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BlocksProvider } from "@/contexts/BlocksContext";
import { UserPanelProvider } from "@/contexts/UserPanelContext";
import { AdminPanelProvider } from "@/contexts/AdminPanelContext";
import { TokenThemeProvider } from "@/contexts/TokenThemeContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ClearSession from "./pages/ClearSession";
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
        <TokenThemeProvider>
          <BlocksProvider>
            <UserPanelProvider>
              <AdminPanelProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <Routes>
                    <Route path="/clear-session" element={<ClearSession />} />
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
              </AdminPanelProvider>
            </UserPanelProvider>
          </BlocksProvider>
        </TokenThemeProvider>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
