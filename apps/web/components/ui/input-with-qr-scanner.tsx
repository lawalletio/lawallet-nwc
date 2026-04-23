'use client'

import * as React from 'react'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QRScanner } from '@/components/ui/qr-scanner'
import { cn } from '@/lib/utils'

/**
 * Controlled text input with a QR-scan icon button to its right. Clicking the
 * button opens the full-screen camera scanner (shared `<QRScanner>`
 * component); on successful decode the result is normalised via `onScan`
 * (defaults to trimmed passthrough into `onChange`).
 *
 * This is the reusable half of the "paste or scan" pattern — the consumer
 * still owns submission (e.g. an adjacent Save button) and validation, so
 * the same widget works for NWC connection URIs, LN invoices, npubs, etc.
 *
 * All remaining props flow to the underlying `<Input>` so callers keep the
 * familiar id / placeholder / aria-* / disabled surface area.
 */
export interface InputWithQrScannerProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Input>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  /**
   * Called with the raw decoded QR text. Defaults to
   * `onChange(text.trim())`. Override for richer transforms (e.g. parsing a
   * bolt11 invoice out of a `lightning:` URI).
   */
  onScan?: (text: string) => void
  /** Forwarded to `QRScanner.onError`. Called on camera-permission / decode failures. */
  onScanError?: (error: string) => void
  /** Accessible label for the QR trigger button. */
  scanLabel?: string
  /** Classes for the flex row wrapping input + button. */
  containerClassName?: string
}

export const InputWithQrScanner = React.forwardRef<
  HTMLInputElement,
  InputWithQrScannerProps
>(function InputWithQrScanner(
  {
    value,
    onChange,
    onScan,
    onScanError,
    scanLabel = 'Scan QR code',
    containerClassName,
    className,
    disabled,
    ...inputProps
  },
  ref,
) {
  return (
    <div className={cn('flex items-center gap-2', containerClassName)}>
      <Input
        ref={ref}
        {...inputProps}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={cn('flex-1', className)}
      />
      <QRScanner
        onScan={text => (onScan ? onScan(text) : onChange(text.trim()))}
        onError={onScanError}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={scanLabel}
          disabled={disabled}
        >
          <QrCode className="size-4" />
        </Button>
      </QRScanner>
    </div>
  )
})
