'use client'

import { CreditCard, Link2, Zap, Palette } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { StatCard } from '@/components/admin/stat-card'
import { useCardCounts } from '@/lib/client/hooks/use-cards'
import { useAddressCounts } from '@/lib/client/hooks/use-addresses'
import { useDesignCount } from '@/lib/client/hooks/use-designs'

export default function AdminDashboardPage() {
  const { data: cardCounts, loading: cardsLoading } = useCardCounts()
  const { data: addressCounts, loading: addressesLoading } = useAddressCounts()
  const { data: designCount, loading: designsLoading } = useDesignCount()

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Dashboard"
        subtitle="Overview of your LaWallet instance"
      />

      <div className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Cards"
            value={cardCounts?.total}
            icon={CreditCard}
            loading={cardsLoading}
          />
          <StatCard
            title="Paired Cards"
            value={cardCounts?.paired}
            icon={Link2}
            loading={cardsLoading}
          />
          <StatCard
            title="Lightning Addresses"
            value={addressCounts?.total}
            icon={Zap}
            loading={addressesLoading}
          />
          <StatCard
            title="Card Designs"
            value={designCount?.count}
            icon={Palette}
            loading={designsLoading}
          />
        </div>
      </div>
    </div>
  )
}
