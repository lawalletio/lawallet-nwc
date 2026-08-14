import { LaWalletProvider } from '@lawallet-nwc/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

/**
 * Endpoint of the LaWallet instance this app serves. Resolved at build time
 * by vite.config.ts: an explicit VITE_LAWALLET_ENDPOINT wins, otherwise this
 * monorepo's own dev instance, otherwise the public one. Whatever it is, it
 * must be the origin the instance is publicly reachable at — NIP-98
 * signatures commit to that exact URL.
 */
export const endpoint: string = import.meta.env.VITE_DEFAULT_ENDPOINT

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LaWalletProvider endpoint={endpoint}>
      <App />
    </LaWalletProvider>
  </StrictMode>
)
