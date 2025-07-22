'use client'

import { useState as useStateHook, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

import { useWallet } from '@/providers/wallet'
import { hexToNsec } from '@/lib/nostr'

import { Button } from '@/components/ui/button'
import { AppNavbar, AppViewport } from '@/components/app'

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
    <AppViewport className="pb-12">
      <AppNavbar>
        <Button variant="secondary" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="text-white">
          <h1 className="text-lg font-bold">Settings</h1>
          {/* <p className="text-muted-foreground text-sm">
              Manage your wallet configuration and keys.
            </p> */}
        </div>
      </AppNavbar>
      <div className="container flex flex-col gap-8">
        {/* Wallet Keys */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <h4 className="text-sm text-white">Wallet Keys</h4>
            <p className="text-sm text-muted-foreground">
              Your wallet&apos;s cryptographic keys
            </p>
          </div>
          <div className="overflow-hidden first-letter:lex flex-col gap-[1px] bg-border border rounded-xl backdrop-blur-sm">
            {/* Public Key */}
            <div className="space-y-3 p-4 bg-black">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-white">
                  Public Key
                </label>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => copyToClipboard(npub || '', 'publicKey')}
                >
                  {copied === 'publicKey' ? (
                    <CheckCircle className="size-4 text-green-400" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <code className="block p-4 bg-white/5 border border-white/10 rounded-xl text-xs font-mono break-all text-gray-300 backdrop-blur-sm">
                {npub}
              </code>
            </div>

            {/* Private Key */}
            <div className="space-y-3 p-4 bg-black">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-white">
                  Private Key (nsec)
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                  >
                    {showPrivateKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() =>
                      copyToClipboard(hexToNsec(privateKey), 'privateKey')
                    }
                  >
                    {copied === 'privateKey' ? (
                      <CheckCircle className="size-4 text-green-400" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
              <code className="block p-4 bg-white/5 border border-white/10 rounded-xl text-xs font-mono break-all text-gray-300 backdrop-blur-sm">
                {showPrivateKey
                  ? hexToNsec(privateKey)
                  : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              </code>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg backdrop-blur-sm">
            <Shield className="size-10 text-red-400" />
            <p className="text-sm text-red-300">
              Keep this private key secure. Never share it with anyone.
            </p>
          </div>
        </div>

        {/* Account Actions */}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm text-white">Danger Zone</h4>
          <div className="overflow-hidden first-letter:lex flex-col gap-[1px] bg-border border rounded-xl backdrop-blur-sm">
            <Button
              className="w-full"
              size="lg"
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
            >
              Logout & Clear Wallet Data
            </Button>
          </div>
        </div>
      </div>
    </AppViewport>
  )
}
