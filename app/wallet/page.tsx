'use client'

import { useEffect, useState } from 'react'
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
import {
  Settings,
  Zap,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2
} from 'lucide-react'

export default function WalletPage() {
  const { privateKey, isInitialized, isHydrated, lightningAddress, nwcUri } =
    useWallet()
  const router = useRouter()
  const [balance, setBalance] = useState(0)
  const [isLoading, setIsLoading] = useState(!isInitialized)

  useEffect(() => {
    if (!isHydrated) return
    // Check authentication first
    const checkAuth = async () => {
      if (!privateKey) {
        router.push('/wallet/login')
        return
      }
      if (!isInitialized) {
        // Only show splash/loading if not initialized
        // Small delay to prevent flash
        await new Promise(resolve => setTimeout(resolve, 500))
        // Simulate loading balance
        setTimeout(() => {
          setBalance(125000) // 125k sats
          setIsLoading(false)
        }, 1000)
      } else {
        setBalance(125000)
        setIsLoading(false)
      }
    }
    checkAuth()
  }, [privateKey, isInitialized, isHydrated, router])

  // Wait for hydration before rendering anything
  if (!isHydrated) {
    return null
  }
  // If not authenticated, don't render anything (will redirect)
  if (!privateKey) {
    return null
  }

  // Show loading splash screen only if not initialized or loading
  if (isLoading || !isInitialized) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-500" />
        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

        <div className="relative z-10 text-center">
          <div className="w-32 h-32 mx-auto mb-8 animate-pulse">
            <img
              src="/nwc-logo.png"
              alt="NWC Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xl text-gray-300 font-light">
              Initializing your wallet...
            </p>
          </div>
        </div>
      </div>
    )
  }

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats)
  }

  const recentTransactions = [
    {
      id: 1,
      type: 'receive',
      amount: 25000,
      description: 'Lightning payment',
      time: '2 min ago'
    },
    {
      id: 2,
      type: 'send',
      amount: -5000,
      description: 'Coffee purchase',
      time: '1 hour ago'
    },
    {
      id: 3,
      type: 'receive',
      amount: 50000,
      description: 'Invoice payment',
      time: '3 hours ago'
    }
  ]

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
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
            <div className="flex items-center gap-1">
              <div className="w-28 h-8 flex items-center justify-center">
                <img
                  src="/nwc-logo.png"
                  alt="NWC Logo"
                  className="w-40 h-40 object-contain m-0"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/wallet/settings')}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-slate-300 backdrop-blur-sm transition-all duration-300 hover:scale-105"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Main Card Display */}
          <div className="mb-12">
            <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/10 overflow-hidden">
              <CardContent className="p-8">
                <div
                  className="relative w-full rounded-2xl overflow-hidden mb-6 group"
                  style={{
                    aspectRatio: '1.586',
                    backgroundImage: `url(/card-primal.png)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  {/* Card Overlay */}

                  {/* Animated Lightning Effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

                  {/* Card Content */}
                  <div className="absolute inset-0 p-6 flex flex-col justify-between text-white">
                    <div className="flex justify-between items-start">
                      <div className="text-right">
                        <span className="text-xl font-bold">
                          {lightningAddress}
                        </span>
                        {!lightningAddress && (
                          <Button
                            variant="outline"
                            size="lg"
                            className="mt-2 ml-2 bg-white/10 border-white/20 text-white hover:bg-white/20 backdrop-blur-sm py-6 text-xl font-semibold w-full"
                            onClick={() =>
                              router.push('/wallet/setup/lightning-address')
                            }
                          >
                            Setup Lightning Address
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="bg-black/50 border-2 border-white/20 shadow-xl rounded-2xl p-4 sm:p-8 flex flex-col items-center justify-center sm:scale-110 w-full max-w-xs sm:max-w-none mx-auto">
                      {nwcUri ? (
                        <>
                          <p className="text-sm sm:text-base opacity-90 mb-2 font-semibold text-white tracking-wide">
                            Balance
                          </p>
                          <p className="font-mono text-2xl sm:text-4xl font-extrabold tracking-widest text-white drop-shadow-lg mb-2">
                            {formatSats(balance)} sats
                          </p>
                          <p className="text-base sm:text-lg opacity-80 mt-2 text-white">
                            ≈ $42.50 USD
                          </p>
                        </>
                      ) : (
                        <Button
                          onClick={() => router.push('/wallet/setup/nwc')}
                          className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transform hover:scale-[1.02] transition-all duration-200 text-xl"
                        >
                          Setup NWC Connection String
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-6">
                  <CardDescription />

                  {/* Action Buttons */}
                  <div className="flex gap-4">
                    <Button className="flex-1 py-6 text-2xl font-bold bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg shadow-green-500/25 transition-all duration-300 hover:scale-105">
                      <ArrowDownLeft className="w-8 h-8 mr-3" />
                      Receive
                    </Button>
                    <Button className="flex-1 py-6 text-2xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:scale-105">
                      <ArrowUpRight className="w-8 h-8 mr-3" />
                      Send
                    </Button>
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
                {recentTransactions.map(tx => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          tx.type === 'receive'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {tx.type === 'receive' ? (
                          <ArrowDownLeft className="w-5 h-5" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-white font-medium">
                          {tx.description}
                        </p>
                        <p className="text-gray-400 text-sm">{tx.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-bold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {tx.amount > 0 ? '+' : ''}
                        {formatSats(Math.abs(tx.amount))} sats
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
