'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { useWallet } from '@/hooks/use-wallet'

import { AppContent, AppFooter, AppNavbar, AppViewport } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const PUBLIC_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000'

export default function LightningAddressSetupPage() {
  const [username, setUsername] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { setLightningAddress } = useWallet()
  const router = useRouter()

  const handleSetup = async () => {
    setIsLoading(true)
    setError('')

    if (!username.trim()) {
      setError('Please enter a username')
      setIsLoading(false)
      return
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      setError(
        'Username can only contain letters, numbers, hyphens, and underscores'
      )
      setIsLoading(false)
      return
    }

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500))

      setLightningAddress(username)

      // Show success and redirect
      setTimeout(() => {
        router.push('/wallet')
      }, 1000)
    } catch (err) {
      setError('Failed to register Lightning Address. Please try again.')
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
            <h1 className="text-lg font-bold text-white">
              Lightning Address Setup
            </h1>
          </div> */}
        </AppNavbar>
        <div className="container flex-1 flex flex-col gap-8">
          <div className="flex flex-col gap-4 py-4">
            <h2 className="text-xl font-semibold leading-none tracking-tight text-white">
              Register Username
            </h2>
            <p className="text-lg font-medium tracking-wide text-muted-foreground">
              Your Lightning Address will be used to receive payments.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <Label htmlFor="username">Choose Username</Label>
            <Input
              id="username"
              placeholder="satoshi"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              autoFocus
            />
            <p className="text-xs text-gray-400">
              Your address will be:{' '}
              <span className="text-white font-mono">
                {username || 'username'}@{PUBLIC_DOMAIN}
              </span>
            </p>
            {error && (
              <Alert
                variant="destructive"
                className="bg-red-500/10 border-red-500/20 backdrop-blur-sm"
              >
                <AlertDescription className="text-red-300">
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        <div className="container">
          <div className="text-center">
            <p className="text-xs text-gray-400">
              Your Lightning Address will be publicly visible and can be used by
              anyone to send you payments
            </p>
          </div>
        </div>
      </AppContent>
      <AppFooter>
        <Button
          className="w-full"
          size="lg"
          onClick={handleSetup}
          disabled={isLoading || !username.trim()}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>Register</>
          )}
        </Button>
      </AppFooter>
    </AppViewport>
  )
}
