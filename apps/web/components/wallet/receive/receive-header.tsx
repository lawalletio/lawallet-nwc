'use client'

import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { useT } from '@/lib/client/i18n'

/** Translated header for the server-rendered receive pages. */
export function ReceiveHeader({
  screen,
  closeStyle
}: {
  screen: 'title' | 'invoiceTitle'
  closeStyle?: boolean
}) {
  const t = useT()
  return <ScreenHeader title={t.receive[screen]} closeStyle={closeStyle} />
}
