'use client'

import { AdminTopbar } from '@/components/admin/admin-topbar'
import { LinkCard } from '@/components/ui/link-card'

const TOOLS = [
  {
    href: '/admin/tools/invoice-lookup',
    title: 'Lightning Invoice lookup',
    description:
      'Decode a bolt11 invoice and find its local owner, wallet and preimage — or the payee node for external invoices.'
  }
]

export default function ToolsPage() {
  return (
    <div className="flex flex-col">
      <AdminTopbar title="Tools" subtitle="Operator utilities." />
      <div className="flex max-w-3xl flex-col gap-2 px-4 py-6 sm:px-6">
        {TOOLS.map(tool => (
          <LinkCard
            key={tool.href}
            href={tool.href}
            title={tool.title}
            description={tool.description}
            className="border border-border"
          />
        ))}
      </div>
    </div>
  )
}
