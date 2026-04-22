'use client'

import { useRouter } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { useAuth } from '@/components/admin/auth-context'
import { RegisterAddressFlow } from '@/components/register/register-address-flow'

export default function RegisterAddressPage() {
  const router = useRouter()
  const { status } = useAuth()

  if (status !== 'authenticated') return null

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Register Address" />
      <RegisterAddressFlow
        successCtaLabel="Go to Dashboard"
        onSuccessCta={() => router.push('/admin')}
      />
    </div>
  )
}
