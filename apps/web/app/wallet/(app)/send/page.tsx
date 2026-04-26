import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { RecipientInput } from '@/components/wallet/send/recipient-input'

export const metadata = { title: 'Send - LaWallet' }

export default function SendRecipientPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Send" closeStyle />
      <RecipientInput />
    </div>
  )
}
