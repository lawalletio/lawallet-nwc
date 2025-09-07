'use client'

import { useWallet } from '@/hooks/use-wallet'
import { useAPI } from '@/providers/api'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useEffect } from 'react'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { signer, userId, getUserId, setUserId, logout, isHydrated } = useAPI()
  const { setLightningAddress, setNwcUri } = useWallet()
  const router = useRouter()

  useEffect(() => {
    if (!userId && signer) {
      ;(async () => {
        try {
          const data = await getUserId()
          setUserId(data.userId)
          data.lightningAddress && setLightningAddress(data.lightningAddress)
          data.nwcString && setNwcUri(data.nwcString)
        } catch {
          console.error('Error getting user ID')
          logout()
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, signer])

  useEffect(() => {
    if (isHydrated && !signer) {
      router.push('/wallet/login')
    }
  }, [signer, isHydrated, router])

  if (!signer) {
    return <></>
  }

  return <>{children}</>
}
