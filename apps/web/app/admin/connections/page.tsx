'use client'

import React from 'react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { ConnectionMap } from '@/components/admin/connection-map/connection-map'

/**
 * `/admin/connections` — the two-column Connection Map (#235).
 *
 * Desktop canvas (≥1024 px in this slice — mobile tabs in #236). Renders
 * the caller's Lightning addresses + Cards on the left, Remote Wallets on
 * the right, with bezier edges for every active binding.
 *
 * The map needs full vertical real estate to be useful, so the page hands
 * the area below the AdminTopbar (~3.5rem) entirely to the canvas.
 */
export default function ConnectionsPage() {
  return (
    <div className="flex h-svh flex-col">
      <AdminTopbar title="Connection Map" />
      <div className="flex-1 min-h-0">
        <ConnectionMap />
      </div>
    </div>
  )
}
