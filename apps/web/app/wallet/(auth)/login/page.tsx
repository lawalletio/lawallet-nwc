import { LoginOptions } from '@/components/wallet/onboarding/login-options'
import { getConfig } from '@/lib/config'

// Whether passkey import is offered comes from the runtime env.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Login - LaWallet'
}

export default function WalletLoginPage() {
  return <LoginOptions importSources={getConfig().passkeyImport.sources} />
}
