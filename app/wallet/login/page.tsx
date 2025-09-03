'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2 } from 'lucide-react'

import { useAPI } from '@/providers/api'
import { generatePrivateKey, nsecToHex, validateNsec } from '@/lib/nostr'

import { AppContent, AppFooter, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LaWalletIcon } from '@/components/icon/lawallet'

export default function WalletLoginPage() {
  const [nsecInput, setNsecInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { loginWithPrivateKey } = useAPI()
  const router = useRouter()

  const handleGenerateWallet = async () => {
    setIsLoading(true)
    setError('')

    try {
      const privateKeyHex = generatePrivateKey()
      loginWithPrivateKey(privateKeyHex)
      router.push('/wallet')
    } catch (err) {
      setError('Failed to generate wallet. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportWallet = async () => {
    setIsLoading(true)
    setError('')

    if (!nsecInput.trim()) {
      setError('Please enter your nsec private key')
      setIsLoading(false)
      return
    }

    if (!validateNsec(nsecInput.trim())) {
      setError('Invalid nsec format. Please check your private key.')
      setIsLoading(false)
      return
    }

    try {
      const privateKeyHex = nsecToHex(nsecInput.trim())
      loginWithPrivateKey(privateKeyHex)
      router.push('/wallet')
    } catch (err) {
      setError('Failed to import wallet. Please check your private key.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AppViewport>
      <AppContent>
        <div className="container flex-1 flex flex-col gap-4 w-full h-full">
          <div className="flex flex-col gap-2 w-full">
            <div className="flex flex-row w-full justify-center pt-20">
              <LaWalletIcon width="250" />
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-end gap-4 w-full">
            <p className="text-muted-foreground text-lg">
              Access your wallet or create a new one
            </p>
            <div className="flex flex-col gap-2 w-full">
              <Label htmlFor="nsec">Private Key (nsec)</Label>
              <Input
                id="nsec"
                type="password"
                placeholder="nsec1..."
                value={nsecInput}
                onChange={e => setNsecInput(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Enter your nsec private key to import your wallet.
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              variant="secondary"
              onClick={handleImportWallet}
              disabled={isLoading || !nsecInput.trim()}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>Import Wallet</>
              )}
            </Button>
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

          <div className="flex items-center w-full gap-2 text-center">
            <div className="opacity-25 w-full h-[1px] bg-muted-foreground"></div>
            <p className="text-sm text-muted-foreground">OR</p>
            <div className="opacity-25 w-full h-[1px] bg-muted-foreground"></div>
          </div>
        </div>
      </AppContent>
      <AppFooter>
        <Button
          className="w-full"
          size="lg"
          onClick={handleGenerateWallet}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>Create new</>
          )}
        </Button>
      </AppFooter>
    </AppViewport>
  )
}
