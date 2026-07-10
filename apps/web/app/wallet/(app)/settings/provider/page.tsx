import { redirect } from 'next/navigation'

export default function ProviderSettingsRedirectPage() {
  redirect('/wallet/settings/remote-wallets')
}
