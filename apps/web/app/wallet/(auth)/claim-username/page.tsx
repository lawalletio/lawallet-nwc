import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'

export const metadata = { title: 'Claim username - LaWallet' }

export default function ClaimUsernamePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader title="Claim username" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Claiming a Lightning address is coming soon. For now, you can
          register from the admin dashboard.
        </p>
        <Button asChild variant="secondary">
          <Link href="/admin">Open admin</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/wallet">Back to wallet</Link>
        </Button>
      </div>
    </div>
  )
}
