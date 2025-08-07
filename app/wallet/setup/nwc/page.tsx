'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react'

import { useWallet } from '@/providers/wallet'

import { AppContent, AppFooter, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function NwcSetupPage() {
  const [nwcUri, setNwcUriState] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { setNwcUri } = useWallet()
  const router = useRouter()

  const validateNwcUri = (uri: string): boolean => {
    return uri.startsWith('nostr+walletconnect://') && uri.includes('?')
  }

  const handleSetup = async () => {
    setIsLoading(true)
    setError('')

    if (!nwcUri.trim()) {
      setError('Please enter a NWC URI')
      setIsLoading(false)
      return
    }

    if (!validateNwcUri(nwcUri.trim())) {
      setError(
        "Invalid NWC URI format. It should start with 'nostr+walletconnect://'"
      )
      setIsLoading(false)
      return
    }

    try {
      // Simulate validation
      await new Promise(resolve => setTimeout(resolve, 1000))

      setNwcUri(nwcUri.trim())

      // Show success and redirect
      setTimeout(() => {
        router.push('/wallet')
      }, 1000)
    } catch (err) {
      setError('Failed to configure NWC. Please check your URI and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AppViewport>
      <AppContent>
        <AppNavbar>
          <Button variant="secondary" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          {/* <div>
          <h1 className="text-lg font-bold text-white">NWC Setup</h1>
        </div> */}
        </AppNavbar>
        <div className="container flex-1">
          <div className="flex flex-col gap-4 py-4">
            <h2 className="text-xl font-semibold leading-none tracking-tight text-white">
              Set your NWC URI
            </h2>
            <p className="text-lg font-medium tracking-wide text-muted-foreground">
              Generate one from wallets like Alby, Primal, Coinos, etc.
            </p>
          </div>
          <div className="space-y-3">
            <Label htmlFor="nwc-uri" className="text-white font-medium">
              NWC Connection URI
            </Label>
            <Textarea
              id="nwc-uri"
              placeholder="nostr+walletconnect://..."
              className="text-white"
              value={nwcUri}
              onChange={e => setNwcUriState(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-gray-400">
              This app and card would be able to spend/receive from your wallet.
            </p>
          </div>

          {error && (
            <Alert
              variant="destructive"
              className="bg-red-500/10 border-red-500/20 backdrop-blur-sm"
            >
              <AlertCircle className="size-4 text-red-400" />
              <AlertDescription className="text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <div className="container">
          <div className="text-center">
            <p className="text-xs text-gray-400">
              NWC allows Nostr applications to request payments from your wallet
              with your permission.
            </p>
          </div>
        </div>
      </AppContent>
      <AppFooter>
        <Button
          className="w-full"
          size="lg"
          onClick={handleSetup}
          disabled={isLoading || !nwcUri.trim()}
        >
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <>Save</>}
        </Button>
      </AppFooter>
    </AppViewport>
  )
}
