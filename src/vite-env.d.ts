/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sync-server base URL. When set, the app uses the remote project store (else OPFS). */
  readonly VITE_DAW_API_URL?: string;
  /** Bearer token matching the server's DAW_API_TOKEN; unset for open local dev / when Supabase auth is on. */
  readonly VITE_DAW_API_TOKEN?: string;
  /** Supabase project URL. Set (with the anon key) to enable the login gate + real per-user auth. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (safe in the client). Pairs with VITE_SUPABASE_URL. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
