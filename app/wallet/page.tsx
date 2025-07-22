'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, Loader2 } from 'lucide-react'

import { useWallet } from '@/providers/wallet'

import { AppContent, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { CardPreview } from '@/components/card-preview'
import { SatoshiIcon } from '@/components/icon/satoshi'
import { Skeleton } from '@/components/ui/skeleton'

const PUBLIC_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000'

export default function WalletPage() {
  const {
    privateKey,
    isInitialized,
    isHydrated,
    lightningAddress,
    nwcUri,
    balance
  } = useWallet()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(!isInitialized)
  const [copied, setCopied] = useState(false)
  const [animatedBalance, setAnimatedBalance] = useState(balance)
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Optionally handle error
    }
  }

  useEffect(() => {
    if (!isHydrated) return
    // Check authentication first
    const checkAuth = async () => {
      if (!privateKey) {
        router.push('/wallet/login')
        return
      }
      if (!isInitialized) {
        // Only show splash/loading if not initialized
        // Small delay to prevent flash
        await new Promise(resolve => setTimeout(resolve, 500))
        // Simulate loading balance
        setTimeout(() => {
          setIsLoading(false)
        }, 1000)
      } else {
        setIsLoading(false)
      }
    }
    checkAuth()
  }, [privateKey, isInitialized, isHydrated, router])

  useEffect(() => {
    if (balance === undefined || balance === null) return
    let start: number | null = null
    const duration = 800 // ms
    const startValue = animatedBalance
    const endValue = balance
    const diff = endValue - startValue

    if (diff === 0) return

    function animate(ts: number) {
      if (start === null) start = ts
      const elapsed = ts - start
      const progress = Math.min(elapsed / duration, 1)
      const currentValue = Math.round(startValue + diff * progress)
      setAnimatedBalance(currentValue)
      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)

    // If the component unmounts or balance changes again, stop animation
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance])

  // Wait for hydration before rendering anything
  if (!isHydrated) {
    return null
  }
  // If not authenticated, don't render anything (will redirect)
  if (!privateKey) {
    return null
  }

  // Show loading splash screen only if not initialized or loading
  if (isLoading || !isInitialized) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

        <div className="relative z-10 text-center">
          <div className="w-32 h-32 mx-auto mb-8 animate-pulse">
            <img
              src="/nwc-logo.png"
              alt="NWC Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xl text-gray-300 font-light">
              Initializing your wallet...
            </p>
          </div>
        </div>
      </div>
    )
  }

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats)
  }

  return (
    <AppViewport>
      <AppNavbar className="justify-between">
        <div className="w-28 h-8 flex items-center justify-center">
          <img
            src="/nwc-logo.png"
            alt="NWC Logo"
            className="w-40 h-40 object-contain m-0"
          />
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => router.push('/wallet/settings')}
        >
          <Settings className="size-4" />
        </Button>
      </AppNavbar>
      <AppContent>
        <div className="container flex flex-col gap-8">
          {/* Header */}

          <div className="flex flex-col gap-2">
            <h4 className="text-sm text-white">Balance</h4>
            <div className="flex items-center">
              <div className="size-8 text-white">
                <SatoshiIcon />
              </div>
              {nwcUri ? (
                <p className="font-mono tracking-widest text-white drop-shadow-lg">
                  <span className="text-2xl sm:text-4xl font-extrabold">
                    {formatSats(Math.floor(animatedBalance / 1000))}
                  </span>
                </p>
              ) : (
                <Skeleton className="w-12 h-8 my-2.5 rounded-full bg-muted-foreground" />
              )}
              <p className="ml-2 text-muted-foreground">SAT</p>
            </div>

            {/* {!nwcUri && (
              <Button
                className="w-full"
                size="lg"
                onClick={() => router.push('/wallet/setup/nwc')}
              >
                Setup NWC
              </Button>
            )} */}
          </div>

          {lightningAddress && (
            <div
              className="overflow-hidden relative w-full flex flex-col gap-2 border p-4 rounded-xl cursor-pointer"
              onClick={() => copyToClipboard(lightningAddress)}
            >
              <div className="flex justify-between w-full">
                <p className="text-sm text-muted-foreground">
                  Lightning Address
                </p>
                {copied && <p className="text-sm text-green-400">Copied</p>}
              </div>
              <div className="flex text-2xl font-bold">
                <p className="text-white">{lightningAddress}</p>
                {/* <p className="text-muted-foreground">@{PUBLIC_DOMAIN}</p> */}
              </div>
            </div>
          )}

          {/* Connected Services */}
          {(!lightningAddress || !nwcUri) && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm text-white">Steps</h4>
              <div className="overflow-hidden first-letter:lex flex-col gap-[1px] bg-border border rounded-xl backdrop-blur-sm">
                <div className="flex items-center justify-between p-4 bg-black">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-white">
                        Nostr Wallet Connect
                      </div>
                      {nwcUri ? (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="size-2 rounded-full bg-green-400 animate-pulse"></div>
                          <p className="text-muted-foreground">Connected</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="size-2 rounded-full bg-muted-foreground"></div>
                          <p className="text-muted-foreground">
                            Not configured
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  {!nwcUri && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="default"
                        onClick={() => router.push('/wallet/setup/nwc')}
                      >
                        Setup
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between p-4 bg-black">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-white">
                        Lightning Address
                      </div>
                      {lightningAddress ? (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="size-2 rounded-full bg-green-400 animate-pulse"></div>
                          <p className="text-muted-foreground">Connected</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="size-2 rounded-full bg-muted-foreground"></div>
                          <p className="text-muted-foreground">
                            Not configured
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!lightningAddress && (
                      <Button
                        variant="default"
                        disabled={!nwcUri}
                        onClick={() =>
                          router.push('/wallet/setup/lightning-address')
                        }
                      >
                        Setup
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <h4 className="text-sm text-white">My Card</h4>
            <CardPreview />
          </div>
        </div>
      </AppContent>
    </AppViewport>
  )
}
