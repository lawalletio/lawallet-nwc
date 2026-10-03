'use client'

import { useEffect } from 'react'
import { preloadTreasureChest } from '@/lib/client/treasure-chest-cache'

/** Warms the claim-chest animation as soon as the app shell mounts. */
export function TreasureChestPreload() {
  useEffect(() => {
    void preloadTreasureChest().catch(() => {
      // The claim screen retries the same loader if this early fetch fails.
    })
  }, [])

  return null
}
