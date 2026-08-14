import { useAuth, useInstanceInfo, useUser } from '@lawallet-nwc/react'
import { useState } from 'react'
import { endpoint } from './main'
import { Backup } from './screens/Backup'
import { Claim } from './screens/Claim'
import { Dashboard } from './screens/Dashboard'
import { Landing } from './screens/Landing'
import { Login } from './screens/Login'

export function App() {
  const { loading: settingsLoading, error: settingsError } = useInstanceInfo()
  const { status } = useAuth()
  const { user, loading: userLoading } = useUser()
  const [showLogin, setShowLogin] = useState(false)
  // A freshly generated nsec must be acknowledged before anything else —
  // Login unmounts as soon as auth succeeds, so the gate lives here.
  const [pendingBackup, setPendingBackup] = useState<string | null>(null)

  if (settingsLoading) {
    return (
      <main className="shell center">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  // Unreachable instance: a wrong endpoint or an instance without cross-origin
  // access is the one failure a newcomer hits, so name it rather than hanging.
  if (settingsError) {
    return (
      <main className="shell center">
        <h1>Can’t reach that instance</h1>
        <p className="muted">
          Tried <code>{endpoint}</code> — {settingsError.message}
        </p>
        <p className="muted">
          Set <code>VITE_LAWALLET_ENDPOINT</code> in <code>.env</code> to your
          own LaWallet instance, then restart the dev server.
        </p>
      </main>
    )
  }

  if (pendingBackup) {
    return (
      <Backup
        nsec={pendingBackup}
        onAcknowledge={() => setPendingBackup(null)}
      />
    )
  }

  if (status !== 'authenticated') {
    return showLogin ? (
      <Login
        onBack={() => setShowLogin(false)}
        onKeyGenerated={setPendingBackup}
      />
    ) : (
      <Landing onStart={() => setShowLogin(true)} />
    )
  }

  if (userLoading && !user) {
    return (
      <main className="shell center">
        <p className="muted">Loading your account…</p>
      </main>
    )
  }

  // No primary lightning address yet → the claim flow (free or paid).
  // Claiming invalidates the user, so this switches to the dashboard on
  // its own the moment the address exists.
  if (!user?.lightningAddress) {
    return <Claim />
  }

  return <Dashboard />
}
