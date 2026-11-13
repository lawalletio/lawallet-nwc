import {
  CashOutHeader,
  CashOutScreen
} from '@/components/wallet/cash-out/cash-out-screen'

export const metadata = { title: 'Cash out - LaWallet' }

export default function CashOutPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CashOutHeader />
      <CashOutScreen />
    </div>
  )
}
