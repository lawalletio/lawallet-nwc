'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWallet } from '@/providers/wallet'
import { hexToNsec } from '@/lib/nostr'
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  Key,
  User,
  Zap,
  Settings,
  CheckCircle,
  Shield
} from 'lucide-react'
import { useState as useStateHook } from 'react'

export default function WalletSettingsPage() {
  const { privateKey, lightningAddress, nwcUri, logout, npub } = useWallet()

  const router = useRouter()
  const [showPrivateKey, setShowPrivateKey] = useStateHook(false)
  const [copied, setCopied] = useStateHook('')

  useEffect(() => {
    if (!privateKey) {
      router.push('/wallet/login')
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(''), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.back()}
              className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Wallet Settings
              </h1>
              <p className="text-gray-400">
                Manage your wallet configuration and keys
              </p>
            </div>
          </div>

          {/* Wallet Keys */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-white text-xl">
                <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/25">
                  <Key className="w-5 h-5 text-white" />
                </div>
                Wallet Keys
              </CardTitle>
              <CardDescription className="text-gray-300">
                Your wallet&apos;s cryptographic keys
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Public Key */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white">
                    Public Key
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(npub || '', 'publicKey')}
                    className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
                  >
                    {copied === 'publicKey' ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <code className="block p-4 bg-white/5 border border-white/10 rounded-xl text-xs font-mono break-all text-gray-300 backdrop-blur-sm">
                  {npub}
                </code>
              </div>

              {/* Private Key */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white">
                    Private Key (nsec)
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                      className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
                    >
                      {showPrivateKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(hexToNsec(privateKey), 'privateKey')
                      }
                      className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
                    >
                      {copied === 'privateKey' ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <code className="block p-4 bg-white/5 border border-white/10 rounded-xl text-xs font-mono break-all text-gray-300 backdrop-blur-sm">
                  {showPrivateKey
                    ? hexToNsec(privateKey)
                    : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                </code>
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg backdrop-blur-sm">
                  <Shield className="w-4 h-4 text-red-400" />
                  <p className="text-xs text-red-300">
                    Keep this private key secure. Never share it with anyone.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Connected Services */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-white text-xl">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <Settings className="w-5 h-5 text-white" />
                </div>
                Connected Services
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Lightning Address */}
              <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-white">
                      Lightning Address
                    </div>
                    {lightningAddress ? (
                      <div className="text-sm text-gray-300 font-mono bg-white/10 px-2 py-1 rounded mt-1">
                        {lightningAddress}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">
                        Not configured
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {lightningAddress ? (
                    <>
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        Active
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(lightningAddress, 'lightningAddress')
                        }
                        className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
                      >
                        {copied === 'lightningAddress' ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        router.push('/wallet/setup/lightning-address')
                      }
                      className="bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white"
                    >
                      Setup
                    </Button>
                  )}
                </div>
              </div>
              {/* NWC */}
              <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                    <Settings className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-white">
                      Nostr Wallet Connect
                    </div>
                    {nwcUri ? (
                      <div className="text-sm text-gray-300">Connected</div>
                    ) : (
                      <div className="text-sm text-gray-400">
                        Not configured
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {nwcUri ? (
                    <>
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        Active
                      </Badge>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => router.push('/wallet/setup/nwc')}
                      className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white"
                    >
                      Setup
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Actions */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-white text-xl">
                <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/25">
                  <User className="w-5 h-5 text-white" />
                </div>
                Account Actions
              </CardTitle>
              <CardDescription className="text-gray-300">
                Manage your wallet account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    confirm(
                      'Are you sure you want to logout? Make sure you have backed up your private key.'
                    )
                  ) {
                    logout()
                    router.push('/wallet/login')
                  }
                }}
                className="w-full h-12 bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg shadow-red-500/25"
              >
                Logout & Clear Wallet Data
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
