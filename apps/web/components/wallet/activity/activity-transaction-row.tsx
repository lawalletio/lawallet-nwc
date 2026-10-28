'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { TransactionRow } from '@/components/wallet/shared/transaction-row'
import { useApi, type UseApiResult } from '@/lib/client/hooks/use-api'
import {
  activityDetailHref,
  isActivityPreviewRequested
} from '@/lib/client/activity-detail'
import { rememberActivityTx } from '@/lib/client/activity-detail-store'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/admin/auth-context'
import { TransactionTagPicker } from './transaction-tag-picker'

export function ActivityTransactionRow({
  tx,
  from
}: {
  tx: NwcTransaction
  from?: 'home'
}) {
  const [expanded, setExpanded] = useState(false)
  const { pubkey } = useAuth()
  const [savedTag, setSavedTag] = useState<{
    pubkey: string | null
    tag: string | null
  } | null>(null)
  const labelPath =
    !isActivityPreviewRequested() &&
    /^[0-9a-fA-F]{64}$/.test(tx.paymentHash || '')
      ? `/api/wallet/transactions/${tx.paymentHash.toLowerCase()}/label`
      : null
  const annotation = useApi<{ label: string | null }>(labelPath)
  const currentTag =
    savedTag?.pubkey === pubkey
      ? savedTag?.tag
      : !annotation.loading && !annotation.error
        ? annotation.data?.label
        : undefined
  const panelId = useId()
  const href = tx.paymentHash
    ? activityDetailHref(tx.paymentHash, from)
    : undefined

  return (
    <div>
      <div className="flex items-center">
        <TransactionRow tx={tx} href={href} className="min-w-0 flex-1" />
        {!isActivityPreviewRequested() &&
        /^[0-9a-fA-F]{64}$/.test(tx.paymentHash || '') ? (
          <TransactionTagPicker
            key={`${pubkey}:${tx.paymentHash}`}
            paymentHash={tx.paymentHash.toLowerCase()}
            tag={currentTag}
            onSaved={tag => setSavedTag({ pubkey, tag })}
          />
        ) : null}
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} transaction information: ${tx.description || (tx.type === 'incoming' ? 'Received' : 'Sent')}`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(value => !value)}
          className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 transition-transform motion-reduce:transition-none',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </div>
      <div id={panelId} hidden={!expanded}>
        {expanded ? (
          <TransactionInformation
            tx={tx}
            href={href}
            savedTag={currentTag}
            annotation={annotation}
          />
        ) : null}
      </div>
    </div>
  )
}

function TransactionInformation({
  tx,
  href,
  savedTag,
  annotation
}: {
  tx: NwcTransaction
  href?: string
  savedTag?: string | null
  annotation: UseApiResult<{ label: string | null }>
}) {
  const { data, loading, error, refetch } = annotation
  const information = (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Message</dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">
          {tx.description || 'No message'}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Tag</dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">
          {error
            ? 'Could not load tag'
            : loading
              ? 'Loading tag…'
              : (savedTag === undefined ? data?.label : savedTag) || 'No tag'}
        </dd>
      </div>
    </dl>
  )

  return (
    <div className="mx-3 mb-3 border-t border-border/40 pt-3">
      {href ? (
        <Link
          href={href}
          onClick={() => rememberActivityTx(tx)}
          className="block rounded-lg px-3 py-2 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {information}
        </Link>
      ) : (
        <div className="px-3 py-2">{information}</div>
      )}
      {error ? (
        <button
          type="button"
          onClick={() => void refetch()}
          className="ml-3 rounded px-2 py-2 text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry tag
        </button>
      ) : null}
    </div>
  )
}
