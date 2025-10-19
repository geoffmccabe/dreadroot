import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function AuthDebugger() {
  useEffect(() => {
    console.log('🐛 AuthDebugger mounted');
    
    // Check localStorage
    const allKeys = Object.keys(localStorage);
    const authKeys = allKeys.filter(k => k.includes('supabase') || k.includes('auth'));
    console.log('🔑 localStorage auth keys:', authKeys);
    authKeys.forEach(key => {
      const value = localStorage.getItem(key);
      console.log(`  ${key}:`, value?.substring(0, 100));
    });
    
    // Check session
    supabase.auth.getSession().then(({ data, error }) => {
      console.log('📊 Current session:', {
        hasSession: !!data.session,
        userId: data.session?.user?.id,
        isAnonymous: data.session?.user?.is_anonymous,
        expiresAt: data.session?.expires_at,
        error: error?.message
      });
    });
    
    return () => {
      console.log('🐛 AuthDebugger unmounting');
    };
  }, []);
  
  return null;
}
