'use client'

import { Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { useAuth } from '@/components/admin/auth-context'
import { RegisterAddressFlow } from '@/components/register/register-address-flow'

function sanitizeUsername(raw: string | null): string {
  if (!raw) return ''
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
}

function RegisterAddressInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status } = useAuth()
  const initialUsername = useMemo(
    () => sanitizeUsername(searchParams.get('username')),
    [searchParams]
  )

  if (status !== 'authenticated') return null

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Register Address" />
      <RegisterAddressFlow
        initialUsername={initialUsername || undefined}
        successCtaLabel="Go to Dashboard"
        onSuccessCta={() => router.push('/admin')}
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
