"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useWallet } from "@/providers/wallet"
import { CardService } from "@/services/card-service"
import { ArrowLeft, CreditCard, Power, PowerOff } from "lucide-react"

export default function WalletCardsPage() {
  const { privateKey } = useWallet()
  const router = useRouter()
  const [cards, setCards] = useState<any[]>([])

  useEffect(() => {
    if (!privateKey) {
      router.push("/wallet/login")
    } else {
      // Get cards assigned to this wallet (mock data for now)
      const allCards = CardService.list()
      const userCards = allCards.filter((card) => card.pubkey) // Cards that are linked/assigned
      setCards(userCards)
    }
  }, [privateKey, router])

  if (!privateKey) {
    return null
  }

  const toggleCardStatus = (cardId: string) => {
    setCards((prevCards) => prevCards.map((card) => (card.id === cardId ? { ...card, ntag424: !card.ntag424 } : card)))
  }

  // Generate random card images for each card
  const getCardImage = (cardId: string) => {
    // Create a simple hash from card ID to ensure consistent image per card
    let hash = 0
    for (let i = 0; i < cardId.length; i++) {
      const char = cardId.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }

    const imageIndex = (Math.abs(hash) % 20) + 1 // Use 20 different images
    return `/placeholder.svg?height=192&width=320&text=Card-${imageIndex}&bg=${Math.abs(hash % 16).toString(16)}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="p-6">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.back()}
              className="bg-white/5 border-white/20 text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">My Cards</h1>
                <p className="text-gray-400">Tap to activate or deactivate</p>
              </div>
            </div>
          </div>

          {/* Cards Display */}
          {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mb-6">
                <CreditCard className="w-12 h-12 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-white">No cards found</h3>
              <p className="text-gray-400">You don't have any cards assigned yet.</p>
            </div>
          ) : (
            <div className="flex gap-6 overflow-x-auto pb-8 px-4">
              {cards.map((card, index) => (
                <div key={card.id} className="flex-shrink-0 cursor-pointer" onClick={() => toggleCardStatus(card.id)}>
                  {/* Card */}
                  <div
                    className={`
                      w-80 h-48 rounded-2xl relative overflow-hidden
                      ${
                        card.ntag424
                          ? "bg-gradient-to-br from-purple-600 to-blue-600"
                          : "bg-gradient-to-br from-gray-700 to-gray-800"
                      }
                    `}
                  >
                    {/* Card Background Image */}
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{
                        backgroundImage: `url('${getCardImage(card.id)}')`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />

                    {/* Card Content */}
                    <div className="relative z-10 p-6 h-full flex flex-col justify-between">
                      {/* Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              card.ntag424 ? "bg-white/20" : "bg-gray-600/50"
                            }`}
                          >
                            {card.ntag424 ? (
                              <Power className="w-4 h-4 text-white" />
                            ) : (
                              <PowerOff className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <Badge
                            className={
                              card.ntag424
                                ? "bg-green-500/30 text-green-200 border-green-400/50"
                                : "bg-red-500/30 text-red-200 border-red-400/50"
                            }
                          >
                            {card.ntag424 ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="text-white/80 text-xs">BoltCard</div>
                      </div>

                      {/* Card Footer - Empty space for clean look */}
                      <div></div>
                    </div>

                    {/* Click overlay */}
                    <div className="absolute inset-0 bg-black/20 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="text-white text-sm font-medium">
                        {card.ntag424 ? "Tap to deactivate" : "Tap to activate"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
