'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useWallet } from '@/providers/wallet'
import { ArrowLeft, Settings, CheckCircle, AlertCircle } from 'lucide-react'

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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">NWC Setup</h1>
            <p className="text-gray-600 text-sm">
              Configure Nostr Wallet Connect
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Nostr Wallet Connect
            </CardTitle>
            <CardDescription>
              Connect your wallet to Nostr applications for seamless payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nwc-uri">NWC Connection URI</Label>
              <Textarea
                id="nwc-uri"
                placeholder="nostr+walletconnect://..."
                value={nwcUri}
                onChange={e => setNwcUriState(e.target.value)}
                className="font-mono text-sm min-h-[100px]"
              />
              <p className="text-xs text-gray-500">
                Paste the NWC URI from your Lightning wallet or service
              </p>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This URI contains sensitive information. Only use URIs from
                trusted sources.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleSetup}
              disabled={isLoading || !nwcUri.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Configuring...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Configure NWC
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-xs text-gray-500">
            NWC allows Nostr applications to request payments from your wallet
            with your permission
          </p>
        </div>
      </div>
    </div>
  )
}
