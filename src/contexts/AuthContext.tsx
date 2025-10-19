import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { blockDB } from '@/hooks/useIndexedDB';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signInAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isSigningInRef = useRef(false); // Guard against multiple sign-in attempts

  const signInAnonymouslyInternal = async () => {
    // Prevent multiple simultaneous sign-in attempts
    if (isSigningInRef.current) {
      console.log('⏸️ Sign-in already in progress, skipping');
      return;
    }

    try {
      isSigningInRef.current = true;
      console.log('🔑 Starting anonymous sign-in...');
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('✅ Signed in anonymously:', data.user?.id);
      
      // Store user ID in IndexedDB for persistent tracking
      if (data.user?.id) {
        await blockDB.setUserId(data.user.id);
      }
      
      return data;
    } catch (error) {
      console.error('❌ Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
      throw error;
    } finally {
      isSigningInRef.current = false;
    }
  };

  useEffect(() => {
    let isInitializing = true;
    let mounted = true;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('🔄 Auth state changed:', event, 'user:', session?.user?.id);
        
        if (!mounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Sync IndexedDB with actual session (non-blocking)
        if (session?.user?.id) {
          setTimeout(async () => {
            const stored = await blockDB.getUserId();
            if (stored !== session.user.id) {
              console.log('🔄 Syncing stored user ID to match session:', session.user.id);
              await blockDB.setUserId(session.user.id);
            }
          }, 0);
        }
        
        // Clear user ID on sign out
        if (event === 'SIGNED_OUT') {
          setTimeout(async () => {
            await blockDB.clearUserId();
          }, 0);
        }
        
        // Only set loading to false if we're not in the initial setup
        if (!isInitializing) {
          setIsLoading(false);
        }
      }
    );

    // THEN check for existing session or auto sign-in
    const initAuth = async () => {
      try {
        // Check Supabase session FIRST (source of truth)
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('❌ Error getting session:', error);
        }
        
        if (!mounted) return;
        
        if (session) {
          // We have an active session - use it
          console.log('✅ Found existing session:', session.user?.id);
          setSession(session);
          setUser(session.user);
          
          // Sync IndexedDB in background
          blockDB.init().then(() => {
            blockDB.setUserId(session.user.id).catch(console.error);
          });
        } else {
          // No session - check if we should create one
          await blockDB.init();
          const trackedUserId = await blockDB.getUserId();
          
          if (trackedUserId) {
            // Had a tracked user but session expired - clear and start fresh
            console.warn('⚠️ Session lost. Creating new anonymous user.');
            await blockDB.clearUserId();
          } else {
            console.log('🔑 First time user, creating anonymous session...');
          }
          
          await signInAnonymouslyInternal();
        }
      } catch (error) {
        console.error('❌ Error in initAuth:', error);
      } finally {
        if (mounted) {
          isInitializing = false;
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInAnonymously = async () => {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('Signed in anonymously:', data.user?.id);
      if (data.user?.id) {
        await blockDB.setUserId(data.user.id);
      }
    } catch (error) {
      console.error('Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await blockDB.clearUserId();
      await supabase.auth.signOut();
      toast.success('Signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signInAnonymously, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
