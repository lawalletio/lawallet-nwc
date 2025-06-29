"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Power, Loader2, CheckCircle, Zap } from "lucide-react"
import { useWallet } from "@/providers/wallet"
import { generatePrivateKey } from "@/lib/nostr"

// Mock function to get card by OTC
function getCardByOTC(otc: string) {
  // In a real app, this would fetch from an API
  return {
    id: `card-${otc}`,
    name: `BoltCard #${otc.slice(-4).toUpperCase()}`,
    otc: otc,
    status: "pending",
    design: Math.floor(Math.random() * 20) + 1,
    createdAt: new Date().toISOString(),
  }
}

export default function ActivateCardPage() {
  const params = useParams()
  const router = useRouter()
  const { setPrivateKey } = useWallet()
  const [card, setCard] = useState<any>(null)
  const [isActivating, setIsActivating] = useState(false)
  const [isActivated, setIsActivated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const otc = params.otc as string

  useEffect(() => {
    // Simulate loading card data
    setTimeout(() => {
      const cardData = getCardByOTC(otc)
      setCard(cardData)
      setIsLoading(false)
    }, 1000)
  }, [otc])

  const handleActivate = async () => {
    setIsActivating(true)

    try {
      // Generate new private key
      const privateKey = generatePrivateKey()

      // Simulate activation process
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Set the private key (this will auto-login)
      setPrivateKey(privateKey)

      setIsActivated(true)

      // Redirect to wallet after a brief success message
      setTimeout(() => {
        router.push("/wallet")
      }, 1500)
    } catch (error) {
      console.error("Failed to activate card:", error)
      setIsActivating(false)
    }
  }

  if (isLoading) {
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
            <img src="/nwc-logo.png" alt="NWC Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xl text-gray-300 font-light">Preparing your card...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

        <div className="relative z-10 text-center">
          <div className="w-32 h-32 mx-auto mb-8">
            <img src="/nwc-logo.png" alt="NWC Logo" className="w-full h-full object-contain opacity-50" />
          </div>
          <h1 className="text-3xl font-bold text-red-400 mb-4">Card Not Found</h1>
          <p className="text-gray-400 text-lg">The activation code you provided is invalid</p>
        </div>
      </div>
    )
  }

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

      <div className="relative z-10 flex items-center justify-center min-h-screen p-8">
        <div className="w-full max-w-2xl">
          {/* Header with Large Logo */}
          <div className="text-center mb-8">
            <div className="w-64 h-64 mx-auto mb-6 relative">
              <img src="/nwc-logo.png" alt="NWC Logo" className="w-full h-full object-contain drop-shadow-2xl" />
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-full blur-3xl animate-pulse" />
            </div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent mb-4 leading-tight">
              Activate Your
              <br />
              <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                BoltCard
              </span>
            </h1>
            <p className="text-xl text-gray-400 font-light max-w-md mx-auto leading-relaxed">
              Transform your physical card into a Lightning-powered payment device
            </p>
          </div>

          {/* Card Preview */}
          <div className="mb-12">
            <Card className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/10 overflow-hidden">
              <CardContent className="p-8">
                <div
                  className="relative w-full h-64 rounded-2xl overflow-hidden mb-6 group"
                  style={{
                    backgroundImage: `url(/card-bg-${card.design}.png)`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  {/* Card Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-600/90 via-blue-600/90 to-cyan-600/90" />

                  {/* Animated Lightning Effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

                  {/* Card Content */}
                  <div className="absolute inset-0 p-6 flex flex-col justify-between text-white">
                    <div className="flex justify-between items-start">
                      <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                        <Zap className="w-6 h-6 text-yellow-300" />
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm mb-2">
                          BoltCard
                        </div>
                        <div className="w-8 h-8 bg-white/20 rounded-lg backdrop-blur-sm" />
                      </div>
                    </div>

                    <div>
                      <p className="text-sm opacity-80 mb-1">Card ID</p>
                      <p className="font-mono text-2xl font-bold tracking-wider">{card.otc.slice(-8).toUpperCase()}</p>
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-3">
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    {card.name}
                  </h3>
                  <p className="text-gray-400 font-mono text-sm">
                    OTC: <span className="text-purple-400">{card.otc}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Activation Button */}
          <div className="text-center">
            <Button
              onClick={handleActivate}
              disabled={isActivating || isActivated}
              className="w-full max-w-md h-16 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 hover:from-purple-700 hover:via-blue-700 hover:to-cyan-700 text-white font-bold text-xl rounded-2xl transition-all duration-500 shadow-2xl shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-105 transform relative overflow-hidden group"
            >
              {/* Button Shine Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

              <div className="relative z-10">
                {isActivating ? (
                  <div className="flex items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Activating Card...</span>
                  </div>
                ) : isActivated ? (
                  <div className="flex items-center justify-center gap-3">
                    <CheckCircle className="w-6 h-6" />
                    <span>Card Activated!</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    <Power className="w-6 h-6" />
                    <span>ACTIVATE CARD</span>
                  </div>
                )}
              </div>
            </Button>

            {isActivated && (
              <div className="mt-6 animate-fade-in">
                <p className="text-green-400 text-lg font-medium mb-2">✨ Success!</p>
                <p className="text-gray-400">Redirecting to your wallet...</p>
              </div>
            )}

            {/* Terms */}
            <div className="mt-8 text-center">
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                By activating this card, you agree to our{" "}
                <span className="text-purple-400 hover:text-purple-300 cursor-pointer">terms of service</span> and{" "}
                <span className="text-purple-400 hover:text-purple-300 cursor-pointer">privacy policy</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Custom CSS for animations */}
      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
      `}</style>
    </div>
  )
}
