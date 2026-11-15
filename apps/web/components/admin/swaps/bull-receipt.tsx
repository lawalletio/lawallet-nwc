'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, Share2 } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Variant = 'full' | 'share'
type Pdf = { key: string; blob: Blob; url: string; filename: string }

const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'full', label: 'Full' },
  { id: 'share', label: 'Shareable' }
]

/**
 * Bull Bitcoin sends no receipt, so LaWallet issues a PDF from the order
 * (`GET /api/wallet/swaps/[id]/receipt`): the full one, or a plain ARS
 * transfer receipt to send the recipient. Fetched with the session token
 * (an <iframe>/<a> can't send it), previewed inline, saved via a blob URL,
 * and shared through the system share sheet where the browser supports files.
 */
export function BullReceipt({
  swapId,
  preview = true,
  className
}: {
  swapId: string
  preview?: boolean
  className?: string
}) {
  const { jwt } = useAuth()
  const [variant, setVariant] = useState<Variant>('full')
  const [pdf, setPdf] = useState<Pdf | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(
    null
  )
  const key = `${swapId}:${variant}`

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    fetch(
      `/api/wallet/swaps/${encodeURIComponent(swapId)}/receipt?variant=${variant}`,
      { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }
    )
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(
            body?.error?.message ?? `Request failed (${res.status})`
          )
        }
        const name = /filename="([^"]+)"/.exec(
          res.headers.get('content-disposition') ?? ''
        )?.[1]
        const blob = await res.blob()
        url = URL.createObjectURL(blob)
        if (cancelled) return URL.revokeObjectURL(url)
        setPdf({
          key: `${swapId}:${variant}`,
          blob,
          url,
          filename: name ?? `comprobante-${swapId}.pdf`
        })
      })
      .catch(err => {
        if (!cancelled) {
          setFailed({
            key: `${swapId}:${variant}`,
            message: err instanceof Error ? err.message : 'Error'
          })
        }
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [swapId, variant, jwt])

  const ready = pdf?.key === key ? pdf : null
  const error = failed?.key === key ? failed.message : null
  const file = ready
    ? new File([ready.blob], ready.filename, { type: 'application/pdf' })
    : null
  const canShare =
    !!file &&
    typeof navigator !== 'undefined' &&
    !!navigator.canShare?.({ files: [file] })

  return (
    <figure className={cn('space-y-2', className)}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-4 text-muted-foreground" />
          Transfer receipt (PDF)
        </span>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Receipt version"
            className="inline-flex rounded-md border p-0.5 text-xs"
          >
            {VARIANTS.map(v => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={variant === v.id}
                onClick={() => setVariant(v.id)}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  variant === v.id
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {canShare && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator
                  .share({
                    files: [file!],
                    title: 'Comprobante de transferencia'
                  })
                  .catch(() => {})
              }
            >
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {ready && (
            <Button asChild size="sm" variant="outline">
              <a href={ready.url} download={ready.filename}>
                <Download className="size-4" /> Download
              </a>
            </Button>
          )}
        </div>
      </figcaption>
      {error ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Couldn’t generate the receipt: {error}
        </p>
      ) : !ready ? (
        <Skeleton className={preview ? 'h-80 w-full' : 'h-9 w-full'} />
      ) : (
        preview && (
          <iframe
            key={ready.url}
            src={`${ready.url}#toolbar=0&navpanes=0&view=FitH`}
            title="Bull Bitcoin transfer receipt"
            className="h-[28rem] w-full rounded-xl border bg-white animate-in fade-in duration-300"
          />
        )
      )}
      <p className="text-[11px] text-muted-foreground">
        {variant === 'share'
          ? 'Pesos only — no sats or Lightning details. Safe to send to the recipient.'
          : 'Issued by LaWallet from the Bull Bitcoin order, with its order id for verification.'}
      </p>
    </figure>
  )
}
