'use client'

import { useWallet } from '@/hooks/use-wallet'
import { useAPI } from '@/providers/api'
import type React from 'react'
import { useEffect } from 'react'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { signer, userId, getUserId, setUserId, logout } = useAPI()
  const { setLightningAddress, setNwcUri } = useWallet()

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

  if (!signer) {
    return <></>
  }

  return <>{children}</>
}
