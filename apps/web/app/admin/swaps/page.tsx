'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SwapsTable } from '@/components/admin/swaps/swaps-table'
import { NewSwapDialog } from '@/components/admin/swaps/new-swap-dialog'
import { SwapsUnavailable } from '@/components/admin/swaps/swaps-unavailable'
import { useSwapsEnabled } from '@/components/admin/swaps/use-swaps-enabled'

function SwapsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const creating = params.get('new') === '1'
  const { enabled, loading } = useSwapsEnabled()

  // Page + dialog live in the URL so back/forward and reloads keep them.
  const setQuery = (next: { page?: number; new?: boolean }) => {
    const q = new URLSearchParams()
    const p = next.page ?? page
    if (p > 1) q.set('page', String(p))
    if (next.new ?? creating) q.set('new', '1')
    const qs = q.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const openNew = () => setQuery({ new: true })

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Swaps"
        subtitle="Lightning → ARS transfers to any Argentine bank account."
        actions={
          enabled && (
            <Button onClick={openNew}>
              <Plus className="size-4" /> New swap
            </Button>
          )
        }
      />
      <div className="px-4 py-6 sm:px-6">
        {loading ? (
          <div className="flex justify-center py-24">
            <Spinner size={24} />
          </div>
        ) : !enabled ? (
          <SwapsUnavailable />
        ) : (
          <SwapsTable
            page={page}
            onPageChange={p => setQuery({ page: p })}
            onOpen={id => router.push(`${pathname}/${encodeURIComponent(id)}`)}
            onNew={openNew}
          />
        )}
      </div>
      {enabled && (
        <NewSwapDialog
          open={creating}
          onOpenChange={open => setQuery({ new: open })}
          onCreated={id =>
            router.replace(`${pathname}/${encodeURIComponent(id)}`)
          }
        />
      )}
    </div>
  )
}

export default function SwapsPage() {
  return (
    <Suspense>
      <SwapsContent />
    </Suspense>
  )
}
