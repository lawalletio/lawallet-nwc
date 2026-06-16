'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { NewAddressDialog } from '@/components/wallet/new-address-dialog'
import { Role } from '@/lib/auth/permissions'

function sanitizeUsername(raw: string | null): string {
  if (!raw) return ''
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
}

const noop = () => undefined

function RegisterAddressInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status, role } = useAuth()
  const { data: settings, loading: settingsLoading } = useSettings(
    status === 'authenticated',
  )
  const [open, setOpen] = useState(true)
  const initialUsername = useMemo(
    () => sanitizeUsername(searchParams.get('username')),
    [searchParams]
  )

  if (status !== 'authenticated') return null

  const userRegistrationEnabled =
    (settings?.registration_user_enabled ?? 'true') === 'true'
  const creationRestricted =
    !settingsLoading && role !== Role.ADMIN && !userRegistrationEnabled

  if (settingsLoading) {
    return (
      <div className="flex flex-col">
        <AdminTopbar title="Register Address" />
        <div className="flex items-center justify-center py-24">
          <Spinner size={24} />
        </div>
      </div>
    )
  }

  if (creationRestricted) {
    return (
      <div className="flex flex-col">
        <AdminTopbar title="Register Address" />
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
          <Alert>
            <AlertTitle>Address registration is admin-only</AlertTitle>
            <AlertDescription>
              This instance only allows admins to create Lightning Addresses.
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => router.replace('/admin/addresses')}>
            Back to addresses
          </Button>
        </div>
      </div>
    )
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) router.replace('/admin/addresses')
  }

  function handleSuccessAction(address: string) {
    const username = address.split('@')[0]
    router.push(`/admin/addresses/${encodeURIComponent(username)}`)
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Register Address" />
      <NewAddressDialog
        open={open}
        onOpenChange={handleOpenChange}
        initialUsername={initialUsername || undefined}
        onCreated={noop}
        onSuccessAction={handleSuccessAction}
      />
    </div>
  )
}

export default function RegisterAddressPage() {
  return (
    <Suspense fallback={null}>
      <RegisterAddressInner />
    </Suspense>
  )
}
