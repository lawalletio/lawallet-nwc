import { SendHeader } from '@/components/wallet/send/send-header'
import { SendAmountStep } from '@/components/wallet/send/amount-step'

export default function SendAmountPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SendHeader step="amountTitle" />
      <SendAmountStep />
    </div>
  )
}
