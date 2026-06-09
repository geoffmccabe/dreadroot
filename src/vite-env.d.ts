/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /** Which game this deployment is (multi-game framework). Defaults to 'dreadroot'. */
  readonly VITE_GAME_ID?: string;
  readonly VITE_SSO_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
