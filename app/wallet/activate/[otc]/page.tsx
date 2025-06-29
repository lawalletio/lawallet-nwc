"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Power, Loader2, CheckCircle } from "lucide-react"
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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-gray-300">Loading card...</p>
        </div>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 text-lg">Card not found</p>
          <p className="text-gray-400 mt-2">Invalid activation code</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20 flex items-center justify-center p-4">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <img src="/nwc-logo.png" alt="NWC Logo" className="w-12 h-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-2">
            Activate Your BoltCard
          </h1>
          <p className="text-gray-400">Ready to activate your new Lightning card</p>
        </div>

        {/* Card Preview */}
        <Card className="bg-gradient-to-br from-white/10 to-white/5 border-white/20 backdrop-blur-sm mb-8">
          <CardContent className="p-6">
            <div
              className="relative w-full h-48 rounded-xl overflow-hidden mb-4"
              style={{
                backgroundImage: `url(/card-bg-${card.design}.png)`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {/* Card Overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/80 to-blue-600/80" />

              {/* Card Content */}
              <div className="absolute inset-0 p-4 flex flex-col justify-between text-white">
                <div className="flex justify-between items-start">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                    <Power className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">BoltCard</span>
                </div>

                <div>
                  <p className="text-sm opacity-80">Card ID</p>
                  <p className="font-mono text-lg">{card.otc.slice(-8).toUpperCase()}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-center">
              <h3 className="text-lg font-semibold text-white">{card.name}</h3>
              <p className="text-gray-400 text-sm">OTC: {card.otc}</p>
            </div>
          </CardContent>
        </Card>

        {/* Activation Button */}
        <Button
          onClick={handleActivate}
          disabled={isActivating || isActivated}
          className="w-full h-14 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold text-lg rounded-xl transition-all duration-300 shadow-lg shadow-purple-500/25"
        >
          {isActivating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Activating Card...
            </div>
          ) : isActivated ? (
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              Card Activated!
            </div>
          ) : (
            "ACTIVATE CARD"
          )}
        </Button>

        {isActivated && (
          <div className="mt-4 text-center">
            <p className="text-green-400 text-sm">Redirecting to your wallet...</p>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 text-center text-xs text-gray-500">
          <p>By activating this card, you agree to our terms of service</p>
        </div>
      </div>
    </div>
  )
}
