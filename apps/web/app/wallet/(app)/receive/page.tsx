import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { ReceiveAddressStep } from '@/components/wallet/receive/address-step'

export const metadata = { title: 'Receive - LaWallet' }

export default function ReceivePage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Receive" closeStyle />
      <ReceiveAddressStep />
    </div>
  )
}
