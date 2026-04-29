import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { ReceiveInvoiceStep } from '@/components/wallet/receive/invoice-step'

export default function ReceiveInvoicePage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Invoice" />
      <ReceiveInvoiceStep />
    </div>
  )
}
