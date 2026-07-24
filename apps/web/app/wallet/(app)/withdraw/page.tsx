import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { WithdrawScreen } from '@/components/wallet/withdraw/withdraw-screen'

export const metadata = { title: 'Withdraw - LaWallet' }

export default function WithdrawPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScreenHeader title="Withdraw" closeStyle />
      <WithdrawScreen />
    </div>
  )
}
