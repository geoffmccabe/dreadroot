import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Keys come from environment: .env locally (gitignored), host env vars in production.
// Never hardcode keys in this file — it is committed to git.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing Supabase config: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (local) or your host's environment settings."
  );
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});