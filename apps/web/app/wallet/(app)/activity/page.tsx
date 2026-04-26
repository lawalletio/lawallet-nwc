import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'

export const metadata = { title: 'Activity - LaWallet' }

export default function ActivityPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Activity" />
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Transaction history is coming soon.
        </p>
      </div>
      <NavTabbar />
    </div>
  )
}
