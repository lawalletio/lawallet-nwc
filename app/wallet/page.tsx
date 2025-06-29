"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/providers/wallet"
import {
  Wallet,
  CreditCard,
  Settings,
  Zap,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  DollarSign,
} from "lucide-react"

export default function WalletPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [balance, setBalance] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    } else {
      // Simulate loading balance
      setTimeout(() => {
        setBalance(125000) // 125k sats
        setIsLoading(false)
      }, 1000)
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats)
  }

  const recentTransactions = [
    { id: 1, type: "receive", amount: 25000, description: "Lightning payment", time: "2 min ago" },
    { id: 2, type: "send", amount: -5000, description: "Coffee purchase", time: "1 hour ago" },
    { id: 3, type: "receive", amount: 50000, description: "Invoice payment", time: "3 hours ago" },
  ]

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
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-2xl shadow-purple-500/25">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Lightning Wallet
                </h1>
                <p className="text-gray-400">Manage your Bitcoin Lightning payments</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/wallet/cards")}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm transition-all duration-300 hover:scale-105"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Cards
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/wallet/settings")}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm transition-all duration-300 hover:scale-105"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Balance Card */}
          <Card className="bg-gradient-to-br from-gray-900/90 to-black/90 backdrop-blur-xl border-gray-700/50 shadow-2xl shadow-black/40 hover:shadow-purple-500/10 transition-all duration-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardDescription className="text-gray-400 mb-2">Total Balance</CardDescription>
                  <CardTitle className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                    {isLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin"></div>
                        Loading...
                      </div>
                    ) : (
                      `${formatSats(balance)} sats`
                    )}
                  </CardTitle>
                  <p className="text-gray-400 mt-1">≈ $42.50 USD</p>
                </div>
                <div className="w-16 h-16 bg-gradient-to-br from-yellow-400/20 to-orange-500/20 rounded-full flex items-center justify-center">
                  <Zap className="w-8 h-8 text-yellow-400" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg shadow-green-500/25 transition-all duration-300 hover:scale-105">
                  <ArrowDownLeft className="w-4 h-4 mr-2" />
                  Receive
                </Button>
                <Button className="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:scale-105">
                  <ArrowUpRight className="w-4 h-4 mr-2" />
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-green-500/10 transition-all duration-300 group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">This Month</p>
                    <p className="text-2xl font-bold text-white">+45,230</p>
                    <p className="text-xs text-green-400">+12.5%</p>
                  </div>
                  <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp className="w-6 h-6 text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-blue-500/10 transition-all duration-300 group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Transactions</p>
                    <p className="text-2xl font-bold text-white">127</p>
                    <p className="text-xs text-blue-400">This week</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Zap className="w-6 h-6 text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20 hover:shadow-purple-500/10 transition-all duration-300 group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Avg. Payment</p>
                    <p className="text-2xl font-bold text-white">2,450</p>
                    <p className="text-xs text-purple-400">sats</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <DollarSign className="w-6 h-6 text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card className="bg-white/10 backdrop-blur-xl border-white/20 shadow-2xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          tx.type === "receive" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {tx.type === "receive" ? (
                          <ArrowDownLeft className="w-5 h-5" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-white font-medium">{tx.description}</p>
                        <p className="text-gray-400 text-sm">{tx.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${tx.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                        {tx.amount > 0 ? "+" : ""}
                        {formatSats(tx.amount)} sats
                      </p>
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
