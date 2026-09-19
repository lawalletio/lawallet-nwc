import { ClaimAddressScreen } from '@/components/wallet/claim/claim-address-screen'

export const metadata = { title: 'Claim username - LaWallet' }

export default async function ClaimUsernamePage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; bonus?: string }>
}) {
  const params = await searchParams
  return (
    <ClaimAddressScreen
      fromActivate={params.from === 'activate'}
      freeBonus={params.bonus === '1'}
    />
  )
}
