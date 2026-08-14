import { LaWalletProvider } from '@lawallet-nwc/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const endpoint = import.meta.env.VITE_LAWALLET_ENDPOINT

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {endpoint ? (
      <LaWalletProvider endpoint={endpoint}>
        <App />
      </LaWalletProvider>
    ) : (
      <main className="shell">
        <h1>Almost there</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and set{' '}
          <code>VITE_LAWALLET_ENDPOINT</code> to your LaWallet instance URL.
        </p>
      </main>
    )}
  </StrictMode>
)
