"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/providers/wallet"
import { Wallet, Settings, Zap, TrendingUp, Clock, ArrowUpRight, ArrowDownLeft } from "lucide-react"

export default function WalletPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      // Small delay to prevent flash
      await new Promise((resolve) => setTimeout(resolve, 500))

      if (!privateKey) {
        router.push("/wallet/login")
        return
      }

      setIsInitializing(false)
    }

    checkAuth()
  }, [privateKey, router])

  // Show loading splash screen while initializing
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/placeholder.svg?height=1080&width=1920')] opacity-5"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

        <div className="relative z-10 text-center space-y-8">
          <div className="mx-auto w-24 h-24 bg-gradient-to-br from-purple-500 to-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-purple-500/25 animate-pulse">
            <Wallet className="w-12 h-12 text-white" />
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Initializing your wallet
            </h1>
            <p className="text-gray-400 text-lg">Setting up your Lightning experience...</p>

            <div className="flex justify-center">
              <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!privateKey) {
    return null
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
            <div className="flex items-center gap-3">
              <div className="w-20 h-12 flex items-center justify-center">
                <img src="/nwc-logo.png" alt="NWC Logo" className="w-32 h-32 object-contain" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => router.push("/wallet/settings")}
                className="bg-white/10 hover:bg-white/20 text-white border-white/20 backdrop-blur-sm transition-all duration-300 hover:scale-105"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Balance Card */}
          <Card className="bg-gradient-to-br from-gray-900/90 to-black/90 border-gray-700/50 shadow-black/40 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Zap className="w-5 h-5 text-yellow-400" />
                Lightning Balance
              </CardTitle>
              <CardDescription />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-4xl font-bold text-white">21,000 sats</div>
                <div className="flex items-center gap-2 text-green-400">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm">+2.5% from last week</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:bg-white/15 transition-all duration-300 cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <ArrowDownLeft className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Receive</h3>
                    <p className="text-sm text-gray-400">Generate invoice or show QR</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:bg-white/15 transition-all duration-300 cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <ArrowUpRight className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Send</h3>
                    <p className="text-sm text-gray-400">Pay invoice or Lightning address</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Clock className="w-5 h-5" />
                Recent Activity
              </CardTitle>
              <CardDescription className="text-gray-400">Your latest Lightning transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { type: "received", amount: "+1,000", description: "Payment received", time: "2 min ago" },
                  { type: "sent", amount: "-500", description: "Coffee payment", time: "1 hour ago" },
                  { type: "received", amount: "+2,500", description: "Invoice payment", time: "3 hours ago" },
                ].map((tx, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          tx.type === "received" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {tx.type === "received" ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <div className="text-white font-medium">{tx.description}</div>
                        <div className="text-sm text-gray-400">{tx.time}</div>
                      </div>
                    </div>
                    <div className={`font-mono ${tx.type === "received" ? "text-green-400" : "text-red-400"}`}>
                      {tx.amount} sats
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Connection Status */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-white font-medium">Connected to Lightning Network</span>
                </div>
                <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                  Online
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
