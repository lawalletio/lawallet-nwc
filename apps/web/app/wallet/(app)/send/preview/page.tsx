import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { SendPreviewStep } from '@/components/wallet/send/preview-step'

export default function SendPreviewPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScreenHeader title="Preview" />
      <SendPreviewStep />
    </div>
  )
}
