'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Eye, EyeOff, Zap, Key, Link, Lock, Camera } from 'lucide-react'
import { useAPI } from '@/providers/api'
import { nsecToHex } from '@/lib/nostr'
import { QRScanner } from '@/components/ui/qr-scanner'

export function Login() {
  const { loginWithSigner, loginWithPrivateKey, loginWithBunker } = useAPI()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [nsec, setNsec] = useState('')
  const [showNsec, setShowNsec] = useState(false)
  const [bunkerUri, setBunkerUri] = useState('')

  const handleNip07Login = async () => {
    setIsLoading(true)
    setError('')

    try {
      if (!window.nostr) {
        throw new Error(
          'No Nostr extension found. Please install Alby or nos2x.'
        )
      }
      await window.nostr.getPublicKey()
      loginWithSigner(window.nostr)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setIsLoading(false)
    }
  }

  const handleNsecLogin = async () => {
    setIsLoading(true)
    setError('')
    try {
      if (!nsec.startsWith('nsec1')) {
        throw new Error('Invalid nsec format. Must start with nsec1')
      }
      loginWithPrivateKey(nsecToHex(nsec))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login with nsec')
    } finally {
      setIsLoading(false)
    }
  }

  const handleBunkerLogin = async () => {
    setIsLoading(true)
    setError('')
    try {
      if (!bunkerUri.startsWith('bunker://')) {
        throw new Error('Invalid bunker URI format. Must start with bunker://')
      }
      await loginWithBunker(bunkerUri)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect to bunker'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleQRScan = async (result: string) => {
    setBunkerUri(result)
    // Auto-login after successful scan if the URI is valid
    if (result.startsWith('bunker://')) {
      try {
        setIsLoading(true)
        setError('')
        await loginWithBunker(result)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to connect to bunker'
        )
      } finally {
        setIsLoading(false)
      }
    } else {
      setError('Scanned QR code is not a valid bunker URI')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl bg-card border-border/50">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <img
                src="/nwc-logo-black.png"
                alt="NWC Logo"
                className="h-12 w-auto"
              />
              <div className="absolute -bottom-1 -right-1 bg-foreground rounded-full p-1">
                <Lock className="h-3 w-3 text-background" />
              </div>
            </div>
          </div>
          <CardTitle className="text-2xl text-foreground">
            Admin Login
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Login with your Nostr identity to access the admin dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="nip07" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-muted">
              <TabsTrigger value="nip07">Extension</TabsTrigger>
              <TabsTrigger value="nsec">Private Key</TabsTrigger>
              <TabsTrigger value="bunker">Bunker</TabsTrigger>
            </TabsList>

            <TabsContent value="nip07" className="space-y-4 pt-4">
              <div className="text-center space-y-4">
                <Zap className="h-12 w-12 mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">
                  Connect using your browser extension (Alby, nos2x, etc.)
                </p>
                <Button
                  onClick={handleNip07Login}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Connecting...' : 'Connect Extension'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="nsec" className="space-y-4 pt-4">
              <div className="space-y-4">
                <div className="text-center">
                  <Key className="h-12 w-12 mx-auto text-primary mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Paste your nsec private key
                  </p>
                </div>
                <div className="relative">
                  <Input
                    type={showNsec ? 'text' : 'password'}
                    placeholder="nsec1..."
                    value={nsec}
                    onChange={e => setNsec(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNsec(!showNsec)}
                  >
                    {showNsec ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Alert variant="default" className="bg-accent border-border">
                  <AlertDescription className="text-xs text-muted-foreground">
                    🔒 Your key never leaves your browser memory.
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleNsecLogin}
                  disabled={isLoading || !nsec}
                  className="w-full"
                >
                  {isLoading ? 'Logging in...' : 'Login with nsec'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="bunker" className="space-y-4 pt-4">
              <div className="space-y-4">
                <div className="text-center">
                  <Link className="h-12 w-12 mx-auto text-primary mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Connect to remote signer
                  </p>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="bunker://..."
                    value={bunkerUri}
                    disabled={isLoading}
                    onChange={e => setBunkerUri(e.target.value)}
                  />
                  <div className="flex justify-center">
                    <QRScanner onScan={handleQRScan}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isLoading}
                        className="flex items-center gap-2"
                      >
                        <Camera className="h-4 w-4" />
                        Scan QR Code
                      </Button>
                    </QRScanner>
                  </div>
                </div>
                <Button
                  onClick={handleBunkerLogin}
                  disabled={isLoading || !bunkerUri}
                  className="w-full"
                >
                  {isLoading ? 'Connecting...' : 'Connect Bunker'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
