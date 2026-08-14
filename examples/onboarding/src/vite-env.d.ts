/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Explicit override — see .env.example. */
  readonly VITE_LAWALLET_ENDPOINT?: string
  /** Resolved by vite.config.ts; never unset. */
  readonly VITE_DEFAULT_ENDPOINT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
