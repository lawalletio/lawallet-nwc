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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useWallet } from '@/providers/wallet'
import { ArrowLeft, Zap, CheckCircle } from 'lucide-react'

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

      const lightningAddress = `${username}@wallet.example.com`
      setLightningAddress(lightningAddress)

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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Lightning Address Setup</h1>
            <p className="text-gray-600 text-sm">
              Choose your Lightning Address
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Register Username
            </CardTitle>
            <CardDescription>
              Your Lightning Address will be used to receive payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Choose Username</Label>
              <div className="flex items-center">
                <Input
                  id="username"
                  placeholder="satoshi"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase())}
                  className="rounded-r-none"
                />
                <div className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-600">
                  @wallet.example.com
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Your Lightning Address will be: {username || 'username'}
                @wallet.example.com
              </p>
            </div>

            <Button
              onClick={handleSetup}
              disabled={isLoading || !username.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Registering...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Register Lightning Address
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
            Your Lightning Address will be publicly visible and can be used by
            anyone to send you payments
          </p>
        </div>
      </div>
    </div>
  )
}
