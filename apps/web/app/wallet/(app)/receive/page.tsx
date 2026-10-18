import { ReceiveHeader } from '@/components/wallet/receive/receive-header'
import { ReceiveAddressStep } from '@/components/wallet/receive/address-step'

export const metadata = { title: 'Receive - LaWallet' }

export default function ReceivePage() {
  return (
    <div className="flex flex-1 flex-col">
      <ReceiveHeader screen="title" closeStyle />
      <ReceiveAddressStep />
    </div>
  )
}
