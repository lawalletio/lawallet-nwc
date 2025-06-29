"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/providers/wallet"
import { ArrowLeft, Power, PowerOff } from "lucide-react"

// Mock card data
const mockCards = [
  { id: "1", name: "Personal Card", isActive: true, publicKey: "npub1abc123...", createdAt: "2024-01-15" },
  { id: "2", name: "Business Card", isActive: false, publicKey: "npub1def456...", createdAt: "2024-01-20" },
  { id: "3", name: "Travel Card", isActive: true, publicKey: "npub1ghi789...", createdAt: "2024-02-01" },
  { id: "4", name: "Shopping Card", isActive: true, publicKey: "npub1jkl012...", createdAt: "2024-02-10" },
  { id: "5", name: "Emergency Card", isActive: false, publicKey: "npub1mno345...", createdAt: "2024-02-15" },
  { id: "6", name: "Family Card", isActive: true, publicKey: "npub1pqr678...", createdAt: "2024-02-20" },
  { id: "7", name: "Work Card", isActive: false, publicKey: "npub1stu901...", createdAt: "2024-02-25" },
  { id: "8", name: "Backup Card", isActive: true, publicKey: "npub1vwx234...", createdAt: "2024-03-01" },
]

export default function WalletCardsPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [cards, setCards] = useState(mockCards)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      // Small delay to prevent flash
      await new Promise((resolve) => setTimeout(resolve, 300))

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
            <Power className="w-12 h-12 text-white" />
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Loading Cards
            </h1>
            <p className="text-gray-400 text-lg">Fetching your BoltCards...</p>

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

  // Simple hash function to generate consistent random values
  const hashCode = (str: string) => {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  const getCardImage = (cardId: string) => {
    const imageIndex = (hashCode(cardId) % 20) + 1
    return `/card-bg-${imageIndex}.png`
  }

  const getCardColor = (cardId: string) => {
    const colors = [
      "from-purple-500 to-blue-600",
      "from-blue-500 to-cyan-500",
      "from-green-500 to-emerald-600",
      "from-orange-500 to-red-500",
      "from-pink-500 to-purple-600",
      "from-indigo-500 to-purple-500",
      "from-teal-500 to-green-500",
      "from-red-500 to-pink-500",
    ]
    return colors[hashCode(cardId) % colors.length]
  }

  const toggleCard = (cardId: string) => {
    setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, isActive: !card.isActive } : card)))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/wallet")}
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              My Cards
            </h1>
            <p className="text-gray-400">Manage your BoltCards</p>
          </div>
        </div>

        {/* Cards Grid */}
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-6 min-w-max">
            {cards.map((card) => (
              <div
                key={card.id}
                onClick={() => toggleCard(card.id)}
                className={`
                  relative w-80 h-48 rounded-2xl cursor-pointer transition-all duration-300
                  ${
                    card.isActive
                      ? `bg-gradient-to-br ${getCardColor(card.id)} shadow-lg`
                      : "bg-gradient-to-br from-gray-600 to-gray-700 shadow-md opacity-70"
                  }
                `}
                style={{
                  backgroundImage: `url(${getCardImage(card.id)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundBlendMode: "overlay",
                }}
              >
                {/* Card Content */}
                <div className="absolute inset-0 bg-black/30 rounded-2xl p-6 flex flex-col justify-between">
                  {/* Top Section */}
                  <div className="flex justify-between items-start">
                    <div className={`p-2 rounded-lg ${card.isActive ? "bg-white/20" : "bg-gray-500/20"}`}>
                      {card.isActive ? (
                        <Power className="w-6 h-6 text-white" />
                      ) : (
                        <PowerOff className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-white/90 text-sm font-medium">BoltCard</p>
                      <div
                        className={`
                        inline-block px-2 py-1 rounded-full text-xs font-medium mt-1
                        ${
                          card.isActive
                            ? "bg-green-500/20 text-green-300 border border-green-500/30"
                            : "bg-red-500/20 text-red-300 border border-red-500/30"
                        }
                      `}
                      >
                        {card.isActive ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </div>

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200">
                    <p className="text-white font-medium">
                      {card.isActive ? "Click to Deactivate" : "Click to Activate"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
