'use client'

import { ShieldX } from 'lucide-react'
import { Role } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'
import { Spinner } from '@/components/ui/spinner'
import { CardEmulator } from '@/components/admin/emulator/card-emulator'

/**
 * `/admin/emulator` — a developer/test BoltCard emulator. ADMIN-only: it
 * exposes raw NTAG424 keys and lets you forge taps, so it's gated more tightly
 * than the rest of the dashboard (OPERATOR has card permissions but not this).
 */
export default function EmulatorPage() {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  if (role !== Role.ADMIN) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldX className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          The card emulator is available to admins only.
        </p>
      </div>
    )
  }

  return <CardEmulator />
}
