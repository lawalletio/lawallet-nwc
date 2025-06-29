"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/providers/wallet"
import { hexToNsec } from "@/lib/nostr"
import { ArrowLeft, Copy, Eye, EyeOff, Key, User, Zap, Settings, CheckCircle } from "lucide-react"
import { useState as useStateHook } from "react"

export default function WalletSettingsPage() {
  const { privateKey, publicKey, lightningAddress, nwcUri, logout } = useWallet()
  const router = useRouter()
  const [showPrivateKey, setShowPrivateKey] = useStateHook(false)
  const [copied, setCopied] = useStateHook("")

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(""), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Wallet Settings</h1>
            <p className="text-gray-600">Manage your wallet configuration and keys</p>
          </div>
        </div>

        {/* Wallet Keys */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Wallet Keys
            </CardTitle>
            <CardDescription>Your wallet's cryptographic keys</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Public Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Public Key</label>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(publicKey || "", "publicKey")}>
                  {copied === "publicKey" ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <code className="block p-3 bg-gray-100 rounded text-xs font-mono break-all">{publicKey}</code>
            </div>

            {/* Private Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Private Key (nsec)</label>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowPrivateKey(!showPrivateKey)}>
                    {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(hexToNsec(privateKey), "privateKey")}
                  >
                    {copied === "privateKey" ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <code className="block p-3 bg-gray-100 rounded text-xs font-mono break-all">
                {showPrivateKey
                  ? hexToNsec(privateKey)
                  : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
              </code>
              <p className="text-xs text-red-600">⚠️ Keep this private key secure. Never share it with anyone.</p>
            </div>
          </CardContent>
        </Card>

        {/* Connected Services */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Connected Services
            </CardTitle>
            <CardDescription>Your wallet's connected services and configurations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Lightning Address */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <Zap className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="font-medium">Lightning Address</div>
                  {lightningAddress ? (
                    <div className="text-sm text-gray-600 font-mono">{lightningAddress}</div>
                  ) : (
                    <div className="text-sm text-gray-500">Not configured</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lightningAddress ? (
                  <>
                    <Badge variant="secondary">Active</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(lightningAddress, "lightningAddress")}
                    >
                      {copied === "lightningAddress" ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => router.push("/wallet/setup/lightning-address")}>
                    Setup
                  </Button>
                )}
              </div>
            </div>

            {/* NWC */}
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <Settings className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <div className="font-medium">Nostr Wallet Connect</div>
                  {nwcUri ? (
                    <div className="text-sm text-gray-600">Connected</div>
                  ) : (
                    <div className="text-sm text-gray-500">Not configured</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {nwcUri ? (
                  <>
                    <Badge variant="secondary">Active</Badge>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(nwcUri, "nwcUri")}>
                      {copied === "nwcUri" ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => router.push("/wallet/setup/nwc")}>
                    Setup
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Account Actions
            </CardTitle>
            <CardDescription>Manage your wallet account</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Are you sure you want to logout? Make sure you have backed up your private key.")) {
                  logout()
                  router.push("/wallet/login")
                }
              }}
              className="w-full"
            >
              Logout & Clear Wallet Data
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
