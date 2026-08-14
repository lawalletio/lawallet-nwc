/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Resolved by vite.config.ts; never unset. */
  readonly VITE_DEFAULT_ENDPOINT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
