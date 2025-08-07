'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { BadgeX, Loader2 } from 'lucide-react'

import { useWallet } from '@/hooks/use-wallet'
import { generatePrivateKey, getPublicKeyFromPrivate } from '@/lib/nostr'

import { Button } from '@/components/ui/button'
import { AppContent, AppFooter, AppViewport } from '@/components/app'
import { CardPreview } from '@/components/card-preview'
import { useCardOTC } from '@/hooks/use-card-otc'
import { useUser } from '@/hooks/use-user'
import { useAPI } from '@/providers/api'

export default function ActivateCardPage() {
  const params = useParams()
  const router = useRouter()
  const { setPrivateKey, setUserId } = useAPI()
  const [card, setCard] = useState<any>(null)
  const [isActivated, setIsActivated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const otc = params.otc as string
  const { card: otcCard, error: otcError } = useCardOTC(otc)
  const { createUser, isLoading: isActivating } = useUser()

  useEffect(() => {
    if (!otcCard) {
      return
    }
    setCard(otcCard)
    setIsLoading(false)
  }, [otcCard])

  const handleActivate = async () => {
    try {
      // Generate new private key
      const privateKey = generatePrivateKey()
      const pubkey = getPublicKeyFromPrivate(privateKey)

      // Set the private key (this will auto-login the user)
      setPrivateKey(privateKey)
      const user = await createUser({ pubkey, otc })
      setUserId(user.userId)

      setIsActivated(true)

      // Redirect to wallet after a brief success message
      router.push('/wallet')
    } catch (error) {
      console.error('Failed to activate card:', error)
    }
  }

  if (otcError) {
    return (
      <AppViewport className="overflow-y-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        </div>

        <AppContent>
          <div className="container-sm flex-1 flex flex-col justify-center items-center gap-4 text-center">
            <BadgeX className="w-32 h-32 text-red-400" />
            <p className="text-xl text-gray-300 font-light">
              OTC Error: {otcError}
            </p>
          </div>
        </AppContent>
      </AppViewport>
    )
  }

  if (isLoading) {
    return (
      <AppViewport className="overflow-y-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        </div>

        <AppContent>
          <div className="container-sm flex-1 flex flex-col justify-center items-center gap-4 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xl text-gray-300 font-light">
              Preparing your card
            </p>
          </div>
        </AppContent>
      </AppViewport>
    )
  }

  if (!card) {
    return (
      <AppViewport>
        <AppContent>
          <div className="container-sm flex-1 flex flex-col justify-center gap-4 text-center px-4">
            <div className="w-32 h-32 mx-auto">
              <img
                src="/nwc-logo.png"
                alt="NWC Logo"
                className="w-full h-full object-contain opacity-50"
              />
            </div>
            <h1 className="text-3xl font-bold text-destructive">
              Card Not Found
            </h1>
            <p className="text-muted-foreground text-lg">
              The activation code you provided is invalid
            </p>
          </div>
        </AppContent>
        <AppFooter>
          <Button className="w-full" variant="secondary" size="lg" asChild>
            <Link href="/">Go home</Link>
          </Button>
        </AppFooter>
      </AppViewport>
    )
  }

  return (
    <AppViewport>
      <AppContent>
        <div className="container flex-1 flex flex-col items-center">
          {/* Header with Large Logo */}
          <div className="text-center mb-4">
            <div className="w-48 h-20 mx-auto mb-3 relative">
              <img
                src="/nwc-logo.png"
                alt="NWC Logo"
                className="w-full h-full object-contain drop-shadow-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-full blur-3xl animate-pulse" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent mb-2 leading-tight">
              Activate Your{' '}
              <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                BoltCard
              </span>
            </h1>
          </div>

          <CardPreview card={card} />

          {/* Activation Button */}
          <div className="text-center">
            {isActivated && (
              <div className="my-6 animate-fade-in">
                <p className="text-green-400 text-lg font-medium mb-2">
                  ✨ Perfect!
                </p>
                <p className="text-muted-foreground">
                  Redirecting to your wallet...
                </p>
              </div>
            )}
          </div>
        </div>
      </AppContent>
      <AppFooter className="flex flex-col">
        <Button
          className="w-full"
          size="lg"
          onClick={handleActivate}
          disabled={isActivating || isActivated}
        >
          {isActivating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isActivated ? (
            <span>Card Activated!</span>
          ) : (
            <span>Activate</span>
          )}
        </Button>

        {/* Terms */}
        <div className="container-sm flex items-center text-center px-8">
          <Button size="sm" variant="link" asChild>
            <Link href="#">Terms of Service</Link>
          </Button>
          <p className="text-xs text-gray-500">-</p>
          <Button size="sm" variant="link" asChild>
            <Link href="#">Privacy Policy</Link>
          </Button>
        </div>
      </AppFooter>
    </AppViewport>
  )
}
