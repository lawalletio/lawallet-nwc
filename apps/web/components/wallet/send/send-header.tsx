'use client'

import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { useT } from '@/lib/client/i18n'

/** Translated header for the server-rendered send pages. */
export function SendHeader({
  step,
  closeStyle
}: {
  step: 'title' | 'amountTitle' | 'previewTitle'
  closeStyle?: boolean
}) {
  const t = useT()
  return <ScreenHeader title={t.send[step]} closeStyle={closeStyle} />
}
