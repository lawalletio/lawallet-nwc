import { SendHeader } from '@/components/wallet/send/send-header'
import { RecipientInput } from '@/components/wallet/send/recipient-input'

export const metadata = { title: 'Send - LaWallet' }

export default function SendRecipientPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SendHeader step="title" closeStyle />
      <RecipientInput />
    </div>
  )
}
