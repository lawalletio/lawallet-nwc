import { useAuth, useInstanceInfo, useUser } from '@lawallet-nwc/react'
import { useState } from 'react'
import { Claim } from './screens/Claim'
import { Dashboard } from './screens/Dashboard'
import { Landing } from './screens/Landing'
import { Login } from './screens/Login'

export function App() {
  const { loading: settingsLoading } = useInstanceInfo()
  const { status } = useAuth()
  const { user, loading: userLoading } = useUser()
  const [showLogin, setShowLogin] = useState(false)

  if (settingsLoading) {
    return (
      <main className="shell center">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (status !== 'authenticated') {
    return showLogin ? (
      <Login onBack={() => setShowLogin(false)} />
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
