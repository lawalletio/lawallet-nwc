import { ReceiveHeader } from '@/components/wallet/receive/receive-header'
import { ReceiveInvoiceStep } from '@/components/wallet/receive/invoice-step'

export default function ReceiveInvoicePage() {
  return (
    <div className="flex flex-1 flex-col">
      <ReceiveHeader screen="invoiceTitle" />
      <ReceiveInvoiceStep />
    </div>
  )
}
