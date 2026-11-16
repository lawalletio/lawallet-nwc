'use client'

import { AdminTopbar } from '@/components/admin/admin-topbar'
import { useAuth } from '@/components/admin/auth-context'
import { LinkCard } from '@/components/ui/link-card'
import { Role } from '@/lib/auth/permissions'

const TOOLS = [
  {
    href: '/admin/tools/polls',
    title: 'Polls',
    description:
      'Ask users to rank or pick options from their wallet, then watch the results live.',
    adminOnly: true
  },
  {
    href: '/admin/tools/invoice-lookup',
    title: 'Lightning Invoice lookup',
    description:
      'Decode a bolt11 invoice and find its local owner, wallet and preimage — or the payee node for external invoices.'
  }
]

export default function ToolsPage() {
  const { role } = useAuth()
  return (
    <div className="flex flex-col">
      <AdminTopbar title="Tools" subtitle="Operator utilities." />
      <div className="flex max-w-3xl flex-col gap-2 px-4 py-6 sm:px-6">
        {TOOLS.filter(tool => !tool.adminOnly || role === Role.ADMIN).map(
          tool => (
            <LinkCard
              key={tool.href}
              href={tool.href}
              title={tool.title}
              description={tool.description}
              className="border border-border"
            />
          )
        )}
      </div>
    </div>
  )
}
