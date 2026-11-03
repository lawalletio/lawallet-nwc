import { SecurityScreen } from '@/components/wallet/settings/security-screen'
import { getConfig } from '@/lib/config'

// Passkey import sources come from the runtime env, not the build.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Security - LaWallet' }

export default function SecurityPage() {
  return (
    <SecurityScreen passkeyImportSources={getConfig().passkeyImport.sources} />
  )
}
