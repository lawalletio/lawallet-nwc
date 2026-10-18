import { ReceiveHeader } from '@/components/wallet/receive/receive-header'
import { ReceiveAmountStep } from '@/components/wallet/receive/amount-step'

export default function ReceiveAmountPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ReceiveHeader screen="title" />
      <ReceiveAmountStep />
    </div>
  )
}
