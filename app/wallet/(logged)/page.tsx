'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, Loader2, BadgeAlert } from 'lucide-react'

import { useWallet } from '@/hooks/use-wallet'
import { useAPI } from '@/providers/api'
import { useCards } from '@/hooks/use-cards'

import { AppContent, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { CardsGallery } from '@/components/cards-gallery'
import { SatoshiIcon } from '@/components/icon/satoshi'
import { LaWalletIcon } from '@/components/icon/lawallet'
import { NwcLnWidget } from '@/components/wallet/settings/nwc-ln-widget'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

export default function WalletPage() {
  const { lightningAddress, nwcUri, balance, isConnected } = useWallet()
  const { isHydrated: apiHydrated, signer, userId } = useAPI()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(!signer)
  const [copied, setCopied] = useState(false)
  const [animatedBalance, setAnimatedBalance] = useState(balance)
  const addressRef = useRef<HTMLDivElement>(null)
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false)
  const [invoice, setInvoice] = useState('')
  const [sendLightningAddress, setSendLightningAddress] = useState('')

  const sendSats = async () => {
    if (!invoice && !sendLightningAddress) return
    // Logic to send sats using invoice or sendLightningAddress
    // Example: await api.sendPayment({ invoice, sendLightningAddress })
    console.log('Sending sats:', { invoice, sendLightningAddress })
    setIsSendDialogOpen(false)
    setInvoice('')
    setSendLightningAddress('')
  }

  // Fetch cards for the current user
  const { cards, isLoading: cardsLoading } = useCards(userId)

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
    if (!apiHydrated) return
    // Check authentication first
    const checkAuth = async () => {
      if (!signer) {
        router.push('/wallet/login')
        return
      }
      if (!signer) {
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
  }, [signer, apiHydrated, router])

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
  if (!apiHydrated) {
    return null
  }
  // If not authenticated, don't render anything (will redirect)
  if (!signer) {
    return null
  }

  // Show loading splash screen only if not initialized or loading
  if (isLoading || !signer) {
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
            <LaWalletIcon width="200" />
            {/* <img
              src="/nwc-logo.png"
              alt="NWC Logo"
              className="w-full h-full object-contain"
            /> */}
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
        <div className="w-32 h-8 flex items-center justify-center">
          <LaWalletIcon
            width="200"
            className="object-contain drop-shadow-2xl"
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
          {lightningAddress && (
            <div
              className="overflow-hidden relative w-full flex flex-col gap-2 border p-4 rounded-xl cursor-pointer"
              onClick={() => copyToClipboard(lightningAddress)}
            >
              <div className="flex gap-2 w-full">
                <p className="text-sm text-muted-foreground">
                  Lightning Address
                </p>
                {copied && <p className="text-sm text-green-400">Copied</p>}
              </div>
              <div ref={addressRef} className="flex font-bold w-full">
                <p
                  className="text-white w-full text-center"
                  style={{
                    fontSize: `${45 - lightningAddress.length * 0.9}px`
                  }}
                >
                  {lightningAddress}
                </p>
                {/* <p className="text-muted-foreground">@{PUBLIC_DOMAIN}</p> */}
              </div>
            </div>
          )}

          <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" size="lg">
                Enviar Sats
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enviar Sats</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <Textarea
                  placeholder="Invoice"
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                />
                <Input
                  placeholder="Lightning Address"
                  value={sendLightningAddress}
                  onChange={(e) => setSendLightningAddress(e.target.value)}
                />
                <Button onClick={sendSats} disabled={!invoice && !sendLightningAddress}>
                  Enviar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex flex-col gap-2">
            {nwcUri && (
              <div
                className={`flex items-center ${isConnected ? 'text-white' : 'text-gray-400 animate-pulse'}`}
              >
                <div className="font-mono  text-center justify-center text-4xl font-extrabold flex items-center flex-row w-full">
                  <span className="size-8 ">
                    <SatoshiIcon />{' '}
                  </span>
                  <span className="text-4xl font-extrabold">
                    {formatSats(Math.floor(animatedBalance / 1000))}
                  </span>
                  {!isConnected && (
                    <BadgeAlert className="text-yellow-500 text-sm ml-2" />
                  )}
                </div>
              </div>
            )}

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

          {/* Connected Services */}
          {(!lightningAddress || !nwcUri) && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm text-white">Steps</h4>

              <NwcLnWidget
                nwcUri={nwcUri || undefined}
                lightningAddress={lightningAddress || undefined}
                isNWCConnected={isConnected}
              />
            </div>
          )}

          {cards.length > 0 && (
            <div className="flex flex-col gap-4">
              {cards.length > 1 && (
                <h4 className="text-sm text-white">My Cards</h4>
              )}
              <CardsGallery cards={cards} />
            </div>
          )}

          {cards.length === 0 && !cardsLoading && (
            <div className="flex flex-col gap-4">
              <h4 className="text-sm text-white">No Cards Found</h4>
              <p className="text-muted-foreground text-sm">
                You don&apos;t have any cards yet.
              </p>
            </div>
          )}
        </div>
      </AppContent>
    </AppViewport>
  )
}
