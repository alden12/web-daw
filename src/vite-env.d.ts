/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sync-server base URL. When set, the app uses the remote project store (else OPFS). */
  readonly VITE_DAW_API_URL?: string;
  /** Bearer token matching the server's DAW_API_TOKEN; unset for open local dev. */
  readonly VITE_DAW_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
