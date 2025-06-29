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
import { Eye, EyeOff, Zap, Key, Link, Lock } from 'lucide-react'
import { useAdmin } from './admin-provider'

export function Login() {
  const { setAuth } = useAdmin()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nsec, setNsec] = useState('')
  const [showNsec, setShowNsec] = useState(false)
  const [bunkerUri, setBunkerUri] = useState('')

  const handleNip07Login = async () => {
    setLoading(true)
    setError('')

    try {
      if (!window.nostr) {
        throw new Error(
          'No Nostr extension found. Please install Alby or nos2x.'
        )
      }
      const pubkey = await window.nostr.getPublicKey()
      setAuth({ pubkey, method: 'nip07', connected: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setLoading(false)
    }
  }

  const handleNsecLogin = async () => {
    setLoading(true)
    setError('')
    try {
      if (!nsec.startsWith('nsec1')) {
        throw new Error('Invalid nsec format. Must start with nsec1')
      }
      const mockPubkey = 'npub1' + Math.random().toString(36).substr(2, 59)
      setAuth({ pubkey: mockPubkey, method: 'nsec', connected: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login with nsec')
    } finally {
      setLoading(false)
    }
  }

  const handleBunkerLogin = async () => {
    setLoading(true)
    setError('')
    try {
      if (!bunkerUri.startsWith('nsec://')) {
        throw new Error('Invalid bunker URI format. Must start with nsec://')
      }
      const mockPubkey = 'npub1' + Math.random().toString(36).substr(2, 59)
      setAuth({ pubkey: mockPubkey, method: 'bunker', connected: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect to bunker'
      )
    } finally {
      setLoading(false)
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
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? 'Connecting...' : 'Connect Extension'}
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
                  disabled={loading || !nsec}
                  className="w-full"
                >
                  {loading ? 'Logging in...' : 'Login with nsec'}
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
                <Input
                  placeholder="nsec://..."
                  value={bunkerUri}
                  onChange={e => setBunkerUri(e.target.value)}
                />
                <Button
                  onClick={handleBunkerLogin}
                  disabled={loading || !bunkerUri}
                  className="w-full"
                >
                  {loading ? 'Connecting...' : 'Connect Bunker'}
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
