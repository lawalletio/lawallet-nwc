"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/providers/wallet"
import {
  Wallet,
  Zap,
  Settings,
  DollarSign,
  AlertCircle,
  CheckCircle,
  User,
  TrendingUp,
  ArrowUpRight,
  CreditCard,
} from "lucide-react"

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-purple-500/25">
                <Wallet className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  {lightningAddress || "My Wallet"}
                </h1>
                <p className="text-gray-400">Lightning Wallet Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/wallet/cards")}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Cards
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/wallet/settings")}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm"
              >
                <User className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Balance Card */}
          <Card className="bg-gradient-to-br from-gray-900/90 to-black/90 backdrop-blur-xl border-gray-700/50 shadow-2xl shadow-black/40 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-blue-500/5"></div>
            <CardHeader className="relative">
              <CardTitle className="flex items-center gap-3 text-white text-xl">
                <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/25">
                  <DollarSign className="w-5 h-5 text-white" />
                </div>
                Balance
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              <div className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <div className="text-4xl font-bold text-white">{formatBalance(balance)}</div>
                  <div className="text-lg text-gray-300">sats</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xl text-gray-300">≈ ${satsToUsd(balance)} USD</div>
                  <div className="flex items-center gap-1 text-green-400 text-sm">
                    <TrendingUp className="w-4 h-4" />
                    +2.4%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Setup Cards Grid */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Lightning Address Setup */}
            {!lightningAddress ? (
              <Card
                className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-purple-500/10 transition-all duration-300 group cursor-pointer"
                onClick={() => router.push("/wallet/setup/lightning-address")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25 group-hover:scale-110 transition-transform duration-200">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    Lightning Address
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Set up your Lightning Address to receive payments easily
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-orange-400" />
                      <span className="text-gray-300">Not configured</span>
                    </div>
                    <ArrowUpRight className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    Lightning Address
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Your Lightning Address is active and ready to receive payments
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <span className="font-mono text-sm text-white bg-white/10 px-3 py-1 rounded-lg">
                        {lightningAddress}
                      </span>
                    </div>
                    <div className="px-3 py-1 bg-green-500/20 text-green-400 text-sm font-medium rounded-full border border-green-500/30">
                      Active
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* NWC Setup */}
            {!nwcUri ? (
              <Card
                className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-purple-500/10 transition-all duration-300 group cursor-pointer"
                onClick={() => router.push("/wallet/setup/nwc")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25 group-hover:scale-110 transition-transform duration-200">
                      <Settings className="w-5 h-5 text-white" />
                    </div>
                    Nostr Wallet Connect
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Connect your wallet to Nostr applications for seamless payments
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-orange-400" />
                      <span className="text-gray-300">Not configured</span>
                    </div>
                    <ArrowUpRight className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                      <Settings className="w-5 h-5 text-white" />
                    </div>
                    Nostr Wallet Connect
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Your wallet is connected and ready for Nostr applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <span className="text-gray-300">Connected</span>
                    </div>
                    <div className="px-3 py-1 bg-green-500/20 text-green-400 text-sm font-medium rounded-full border border-green-500/30">
                      Active
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
