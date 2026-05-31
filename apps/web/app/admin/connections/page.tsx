'use client'

import React from 'react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { ConnectionMap } from '@/components/admin/connection-map/connection-map'
import { ConnectionMapMobile } from '@/components/admin/connection-map/mobile/connection-map-mobile'
import { useIsBelowWidth } from '@/components/ui/use-mobile'
import { Spinner } from '@/components/ui/spinner'

/**
 * `/admin/connections` — the Connection Map (#235 desktop canvas, #236
 * mobile tabs).
 *
 * Layout is chosen by viewport width, not CSS visibility: below 1024 px
 * (the spec's tablet + phone range) we render the three-tab list view;
 * at 1024 px and up the xyflow desktop canvas. Picking one tree avoids
 * mounting the heavy canvas on phones (and vice-versa) — only the
 * active layout's data hooks + components run.
 *
 * `useIsBelowWidth` is `undefined` until the first client measurement;
 * we hold a neutral spinner during that frame so neither branch flashes
 * before the breakpoint resolves.
 */
export default function ConnectionsPage() {
  const belowLg = useIsBelowWidth(1024)

  return (
    <div className="flex h-svh flex-col">
      <AdminTopbar title="Connection Map" />
      <div className="flex-1 min-h-0">
        {belowLg === undefined ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={24} className="text-muted-foreground" />
          </div>
        ) : belowLg ? (
          <ConnectionMapMobile />
        ) : (
          <ConnectionMap />
        )}
      </div>
    </div>
  )
}
