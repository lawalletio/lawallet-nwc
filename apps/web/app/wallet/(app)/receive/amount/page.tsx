import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { ReceiveAmountStep } from '@/components/wallet/receive/amount-step'

export default function ReceiveAmountPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Amount" />
      <ReceiveAmountStep />
    </div>
  )
}
