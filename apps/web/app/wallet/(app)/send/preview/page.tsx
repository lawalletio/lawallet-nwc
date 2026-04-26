import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { SendPreviewStep } from '@/components/wallet/send/preview-step'

export default function SendPreviewPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Preview" />
      <SendPreviewStep />
    </div>
  )
}
