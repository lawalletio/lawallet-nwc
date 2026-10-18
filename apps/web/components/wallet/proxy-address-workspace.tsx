'use client'

import type { ReactNode } from 'react'
import { Activity, CircleDollarSign, Gauge } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/client/i18n'

interface ProxyAddressWorkspaceProps {
  enabled: boolean
  balance: ReactNode
  payments: ReactNode
  activity: ReactNode
  children: ReactNode
}

/**
 * Adds the operational tab rail only for configured deferred-proxy addresses.
 * Other address modes use the same clear hierarchy: choose the mode first,
 * inspect the resulting balance second, then review invoices in their own
 * card. Keeping those surfaces separate prevents the mode selector from
 * looking like part of invoice history.
 */
export function ProxyAddressWorkspace({
  enabled,
  balance,
  payments,
  activity,
  children
}: ProxyAddressWorkspaceProps) {
  const t = useT().addresses.workspace
  if (!enabled) {
    return (
      <>
        {children}
        {balance}
        {payments}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Address configuration applies to every operational view, so keep it
      above and visually separate from the tab-specific proxy telemetry. */}
      {children}

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList
          aria-label={t.sections}
          className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0"
        >
          <TabsTrigger
            value="overview"
            className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none [&_svg]:size-4"
          >
            <Gauge data-icon="inline-start" />
            {t.overview}
          </TabsTrigger>
          <TabsTrigger
            value="payments"
            aria-label={t.paymentsReceived}
            className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none [&_svg]:size-4"
          >
            <CircleDollarSign data-icon="inline-start" />
            <span className="hidden sm:inline">{t.paymentsReceived}</span>
            <span className="sm:hidden">{t.payments}</span>
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="gap-2 rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none [&_svg]:size-4"
          >
            <Activity data-icon="inline-start" />
            {t.activity}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="mt-0 focus-visible:ring-offset-0"
        >
          {balance}
        </TabsContent>
        <TabsContent
          value="payments"
          className="mt-0 focus-visible:ring-offset-0"
        >
          {payments}
        </TabsContent>
        <TabsContent
          value="activity"
          className="mt-0 focus-visible:ring-offset-0"
        >
          {activity}
        </TabsContent>
      </Tabs>
    </div>
  )
}
