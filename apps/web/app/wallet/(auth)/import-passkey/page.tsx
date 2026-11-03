import { notFound } from 'next/navigation'
import { PasskeyImportFlow } from '@/components/wallet/onboarding/passkey-import-flow'
import { getConfig } from '@/lib/config'

// Import sources come from the runtime env, not the build.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Use a passkey from another app - LaWallet'
}

export default function ImportPasskeyPage() {
  const { sources } = getConfig().passkeyImport
  if (!sources.length) notFound()
  return <PasskeyImportFlow sources={sources} />
}
