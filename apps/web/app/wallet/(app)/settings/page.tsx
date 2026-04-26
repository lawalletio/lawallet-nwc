import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'

export const metadata = { title: 'Settings - LaWallet' }

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Settings" />
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Settings are coming soon.
        </p>
      </div>
      <NavTabbar />
    </div>
  )
}
