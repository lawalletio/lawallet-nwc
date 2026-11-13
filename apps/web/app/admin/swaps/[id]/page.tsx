'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Spinner } from '@/components/ui/spinner'
import { SwapTracker } from '@/components/admin/swaps/swap-tracker'
import { SwapsUnavailable } from '@/components/admin/swaps/swaps-unavailable'
import { useSwapsEnabled } from '@/components/admin/swaps/use-swaps-enabled'

export default function SwapDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const { enabled, loading } = useSwapsEnabled()

  return (
    <div className="flex flex-col">
      <AdminTopbar
        type="subpage"
        title="Swap"
        subtitle="Live status of this transfer."
        onBack={() => router.push('/admin/swaps')}
      />
      <div className="px-4 py-6 sm:px-6">
        {loading ? (
          <div className="flex justify-center py-24">
            <Spinner size={24} />
          </div>
        ) : !enabled ? (
          <SwapsUnavailable />
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <Link
              href="/admin/swaps"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Swaps
            </Link>
            <SwapTracker
              key={id}
              swapId={id}
              onNew={() => router.push('/admin/swaps?new=1')}
            />
          </div>
        )}
      </div>
    </div>
  )
}
