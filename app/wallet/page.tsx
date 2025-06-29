"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowUpRight, ArrowDownLeft, Settings, CreditCard, Loader2 } from "lucide-react"
import { useWallet } from "@/providers/wallet"

export default function WalletPage() {
  const router = useRouter()
  const { privateKey, publicKey, lightningAddress, balance } = useWallet()
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    // Add a small delay to prevent flash before checking authentication
    const timer = setTimeout(() => {
      if (!privateKey) {
        router.push("/wallet/login")
      } else {
        setIsInitializing(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [privateKey, router])

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 relative overflow-hidden flex items-center justify-center">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

        <div className="relative z-10 text-center">
          <div className="w-20 h-20 mx-auto mb-6 animate-pulse">
            <img src="/nwc-logo.png" alt="NWC Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xl text-gray-300 font-light">Initializing your wallet...</p>
          </div>
        </div>
      </div>
    )
  }

  const transactions = [
    {
      id: 1,
      type: "received",
      amount: 25000,
      description: "Payment received",
      timestamp: "2 hours ago",
      status: "completed",
    },
    {
      id: 2,
      type: "sent",
      amount: 15000,
      description: "Coffee payment",
      timestamp: "5 hours ago",
      status: "completed",
    },
    {
      id: 3,
      type: "received",
      amount: 50000,
      description: "Invoice payment",
      timestamp: "1 day ago",
      status: "completed",
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        <div className="absolute top-1/4 right-1/3 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl animate-pulse delay-2000" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

      <div className="relative z-10 p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 flex items-center justify-center">
                <img src="/nwc-logo.png" alt="NWC Logo" className="w-32 h-32 object-contain" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button
                onClick={() => router.push("/wallet/cards")}
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Cards
              </Button>
              <Button
                onClick={() => router.push("/wallet/settings")}
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Balance Card */}
          <Card className="bg-gradient-to-br from-gray-900/90 to-black/90 border-gray-700/50 backdrop-blur-xl shadow-2xl shadow-black/40">
            <CardHeader className="pb-4">
              <CardTitle className="text-white text-lg font-medium">Total Balance</CardTitle>
              <CardDescription />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  {balance?.toLocaleString()} sats
                </div>
                <div className="text-2xl text-gray-400">≈ ${((balance || 0) * 0.0004).toFixed(2)} USD</div>
                <div className="flex gap-3 pt-4">
                  <Button className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-medium transition-all duration-300 hover:scale-105 transform">
                    <ArrowDownLeft className="w-4 h-4 mr-2" />
                    Receive
                  </Button>
                  <Button className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium transition-all duration-300 hover:scale-105 transform">
                    <ArrowUpRight className="w-4 h-4 mr-2" />
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/10">
            <CardHeader>
              <CardTitle className="text-white">Recent Transactions</CardTitle>
              <CardDescription className="text-gray-400">Your latest Lightning payments</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 hover:scale-[1.02] transform"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          tx.type === "received" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {tx.type === "received" ? (
                          <ArrowDownLeft className="w-5 h-5" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-white font-medium">{tx.description}</p>
                        <p className="text-gray-400 text-sm">{tx.timestamp}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${tx.type === "received" ? "text-green-400" : "text-blue-400"}`}>
                        {tx.type === "received" ? "+" : "-"}
                        {tx.amount.toLocaleString()} sats
                      </p>
                      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/20">
                        {tx.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
