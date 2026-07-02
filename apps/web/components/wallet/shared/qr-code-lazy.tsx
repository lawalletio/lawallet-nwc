'use client'

import { QRCodeSVG } from 'qrcode.react'

// Thin wrapper around `qrcode.react` so it can be pulled in via `next/dynamic`.
// Keeping the heavyweight QR library out of the shared wallet bundle means the
// home screen ships without it — it only downloads on Receive / Scan.
export interface QrCodeLazyProps {
  value: string
  size: number
  level?: 'L' | 'M' | 'Q' | 'H'
  imageSettings?: {
    src: string
    height: number
    width: number
    excavate: boolean
  }
}

export default function QrCodeLazy({ value, size, level = 'M', imageSettings }: QrCodeLazyProps) {
  return <QRCodeSVG value={value} size={size} level={level} imageSettings={imageSettings} />
}
