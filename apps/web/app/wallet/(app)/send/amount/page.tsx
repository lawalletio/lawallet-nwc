import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { SendAmountStep } from '@/components/wallet/send/amount-step'

export default function SendAmountPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Amount" />
      <SendAmountStep />
    </div>
  )
}
