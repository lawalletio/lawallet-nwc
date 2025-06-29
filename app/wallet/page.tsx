"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/providers/wallet"
import { Wallet, LogOut, Zap, Settings, DollarSign, AlertCircle, CheckCircle, User } from "lucide-react"

export default function WalletPage() {
  const { privateKey, lightningAddress, nwcUri, balance, logout } = useWallet()
  const router = useRouter()

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const formatBalance = (sats: number) => {
    return new Intl.NumberFormat().format(sats)
  }

  const satsToUsd = (sats: number) => {
    // Mock conversion rate: 1 BTC = $45,000, 1 sat = $0.00045
    const usdValue = (sats * 0.00045) / 100
    return usdValue.toFixed(2)
  }

  const handleLogout = () => {
    logout()
    router.push("/wallet/login")
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{lightningAddress || "My Wallet"}</h1>
              <p className="text-gray-600">Lightning Wallet</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/wallet/settings")}>
              <User className="w-4 h-4 mr-2" />
              Settings
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>

        {/* Balance Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-3xl font-bold">{formatBalance(balance)} sats</div>
              <div className="text-gray-600">≈ ${satsToUsd(balance)} USD</div>
            </div>
          </CardContent>
        </Card>

        {/* Setup Cards */}
        <div className="space-y-4">
          {/* Lightning Address Setup */}
          {!lightningAddress ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-500" />
                  Lightning Address
                </CardTitle>
                <CardDescription>Set up your Lightning Address to receive payments easily</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                    <span className="text-gray-600">Not configured</span>
                  </div>
                  <Button onClick={() => router.push("/wallet/setup/lightning-address")}>
                    Set Up Lightning Address
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-500" />
                  Lightning Address
                </CardTitle>
                <CardDescription>Your Lightning Address is active and ready to receive payments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="font-mono text-sm">{lightningAddress}</span>
                  </div>
                  <div className="text-sm text-green-600 font-medium">Active</div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* NWC Setup */}
          {!nwcUri ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-500" />
                  Nostr Wallet Connect
                </CardTitle>
                <CardDescription>Connect your wallet to Nostr applications for seamless payments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                    <span className="text-gray-600">Not configured</span>
                  </div>
                  <Button onClick={() => router.push("/wallet/setup/nwc")} variant="outline">
                    Set Up NWC
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-500" />
                  Nostr Wallet Connect
                </CardTitle>
                <CardDescription>Your wallet is connected and ready for Nostr applications</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-gray-600">Connected</span>
                  </div>
                  <div className="text-sm text-green-600 font-medium">Active</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
