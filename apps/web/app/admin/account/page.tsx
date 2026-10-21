import { Suspense } from 'react'
import { AccountScreen } from '@/components/admin/account/account-screen'

export const metadata = {
  title: 'Account Settings - LaWallet Admin'
}

export default function AccountSettingsPage() {
  // `AccountScreen` reads `?tab=` via `useSearchParams`, which needs a
  // Suspense boundary.
  return (
    <Suspense>
      <AccountScreen />
    </Suspense>
  )
}
