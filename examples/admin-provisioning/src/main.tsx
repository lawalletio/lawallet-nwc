import { LaWalletClient } from '@lawallet-nwc/sdk'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

/** The instance this operator runs. Resolved at build time by vite.config.ts. */
export const endpoint: string = import.meta.env.VITE_DEFAULT_ENDPOINT

/**
 * Browser-side client, deliberately built with NO signer and NO token: it can
 * only reach the public endpoints (settings, username availability). Anything
 * privileged goes through this app's own backend, which holds the admin key.
 */
export const publicClient = new LaWalletClient({ endpoint })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
